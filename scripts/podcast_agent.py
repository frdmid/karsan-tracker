"""Podcastagent: finner nye episoder med Cem Karsan, henter transkripsjon og
analyserer den mot dashbordet med Claude.

Steg:
  1. Oppdagelse: Apple iTunes Search (term "Cem Karsan"), episoden slås opp i
     podkastens egen RSS-feed via iTunes lookup (feedUrl).
  2. Transkripsjon, i prioritert rekkefølge:
       a. <podcast:transcript> i feeden (Top Traders Unplugged har dette, JSON med ord og tid)
       b. lyd transkribert med faster-whisper, bare når TRANSCRIBE_AUDIO=true
  3. Analyse med Claude (bare når ANTHROPIC_API_KEY finnes): sammendrag, påstander
     med tall og tidshorisont, forhold til dashbordet (bekrefter, endrer, nytt) og
     forslag til endringer i config. Forslag legges aldri inn automatisk.

Lagring: data/karsan_episodes.json (metadata og analyse). Transkripsjonen lagres
aldri i repoet (opphavsrett), bare i build/transcripts/ som ikke committes.
Sitater begrenses til 15 ord.

Bruk: python scripts/podcast_agent.py [--max-new 3] [--reanalyze ID]
Feil skal aldri stoppe dataoppdateringen.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET

from common import CONFIG, DATA, ROOT, http_get, now_iso

STATE = DATA / "karsan_episodes.json"
CACHE = ROOT / "build" / "transcripts"
MODEL = "claude-opus-5-5"
NS = {"podcast": "https://podcastindex.org/namespace/1.0", "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}
SEARCH = "https://itunes.apple.com/search?{qs}"
LOOKUP = "https://itunes.apple.com/lookup?id={id}"
MAX_QUOTE_WORDS = 15


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def episode_id(show, title, date=None):
    # Datoen er ikke med: Apple og RSS kan oppgi ulik dato for samme episode (tidssone).
    return hashlib.sha1(f"{norm(show)}|{norm(title)}".encode()).hexdigest()[:12]


# ---------- 1. Oppdagelse ----------

def discover():
    qs = urllib.parse.urlencode({"term": "Cem Karsan", "entity": "podcastEpisode", "limit": 50})
    results = json.loads(http_get(SEARCH.format(qs=qs)))["results"]
    eps = []
    for r in results:
        text = f"{r.get('trackName', '')} {r.get('description', '')}".lower()
        if "karsan" not in text:
            continue
        eps.append({
            "id": episode_id(r.get("collectionName"), r.get("trackName"), r["releaseDate"][:10]),
            "date": r["releaseDate"][:10],
            "show": r.get("collectionName", ""),
            "title": r.get("trackName", ""),
            "link": r.get("trackViewUrl") or r.get("collectionViewUrl"),
            "audio": r.get("episodeUrl"),
            "minutes": round((r.get("trackTimeMillis") or 0) / 60000),
            "collection_id": r.get("collectionId"),
        })
    return eps


_feeds = {}
_feed_urls = {}


def feed_url_for(collection_id):
    if collection_id not in _feed_urls:
        try:
            lk = json.loads(http_get(LOOKUP.format(id=collection_id)))["results"]
            _feed_urls[collection_id] = lk[0].get("feedUrl") if lk else None
        except Exception as e:
            print(f"Oppslag for {collection_id} feilet: {e}", file=sys.stderr)
            _feed_urls[collection_id] = None
    return _feed_urls[collection_id]


def feed_items(url):
    """Henter og mellomlagrer en RSS-feed. Svar: liste av items eller []."""
    if not url:
        return []
    if url not in _feeds:
        try:
            _feeds[url] = ET.fromstring(http_get(url).encode("utf-8")).findall("./channel/item")
        except Exception as e:
            print(f"Feed {url} feilet: {e}", file=sys.stderr)
            _feeds[url] = []
    return _feeds[url]


def discover_own_feeds(days=365):
    """Alle episoder i podkaster der Karsan er fast vert (config/news.json, karsan_feeds)."""
    from datetime import datetime, timedelta, timezone
    from email.utils import parsedate_to_datetime
    cfg = json.loads((CONFIG / "news.json").read_text(encoding="utf-8"))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    eps = []
    for f in cfg.get("karsan", {}).get("feeds", []):
        pattern = re.compile(f.get("match", "."), re.I)
        for it in feed_items(f["url"]):
            if not pattern.search(it.findtext("title") or ""):
                continue
            try:
                date = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc).date().isoformat()
            except Exception:
                continue
            if date < cutoff:
                continue
            enc = it.find("enclosure")
            title = (it.findtext("title") or "").strip()
            eps.append({"id": episode_id(f["name"], title, date), "date": date, "show": f["name"], "title": title,
                        "link": it.findtext("link"), "audio": enc.attrib.get("url") if enc is not None else None,
                        "minutes": None, "feed_url": f["url"]})
    return eps


def find_transcript_url(ep):
    title = norm(ep["title"])
    url = ep.get("feed_url") or feed_url_for(ep.get("collection_id"))
    for it in feed_items(url):
        if norm(it.findtext("title")) != title:
            continue
        tags = it.findall("podcast:transcript", NS)
        for pref in ("application/json", "application/srt", "text/vtt", "text/html"):
            for t in tags:
                if t.attrib.get("type") == pref:
                    return t.attrib["url"], pref
    return None, None


# ---------- 2. Transkripsjon ----------

def text_from_feed(url, kind):
    raw = http_get(url)
    if kind == "application/json":
        segs = json.loads(raw).get("segments", [])
        out, speaker = [], None
        for s in segs:
            sp = s.get("speaker")
            if sp and sp != speaker:
                out.append(f"\n[{sp}]")
                speaker = sp
            out.append(s.get("body", ""))
        return " ".join(out)
    if kind in ("application/srt", "text/vtt"):
        lines = [l for l in raw.splitlines() if l.strip() and "-->" not in l and not l.strip().isdigit() and l.strip() != "WEBVTT"]
        return " ".join(lines)
    return re.sub(r"<[^>]+>", " ", raw)


def text_from_audio(ep):
    from faster_whisper import WhisperModel  # installeres bare i workflow når TRANSCRIBE_AUDIO=true
    import urllib.request
    CACHE.mkdir(parents=True, exist_ok=True)
    mp3 = CACHE / f"{ep['id']}.mp3"
    req = urllib.request.Request(ep["audio"], headers={"User-Agent": "karsan-tracker"})
    with urllib.request.urlopen(req, timeout=300) as r, open(mp3, "wb") as f:
        f.write(r.read())
    model = WhisperModel(os.environ.get("WHISPER_MODEL", "base.en"), device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(mp3), vad_filter=True)
    text = " ".join(s.text.strip() for s in segments)
    mp3.unlink()
    return text


def get_transcript(ep):
    url, kind = find_transcript_url(ep)
    if url:
        return text_from_feed(url, kind), f"RSS podcast:transcript ({kind})", url
    if os.environ.get("TRANSCRIBE_AUDIO", "").lower() == "true" and ep.get("audio"):
        return text_from_audio(ep), f"faster-whisper {os.environ.get('WHISPER_MODEL', 'base.en')}", ep["audio"]
    return None, None, None


# ---------- 3. Analyse ----------

SYSTEM = """Du analyserer transkripsjoner av podcaster der Cem Karsan deltar, for en side som følger narrativet hans mot markedsdata.
Skriv på norsk bokmål. Bruk aldri tankestrek (verken lang eller kort), bruk komma, punktum eller kolon. Ingen emojier.
Ikke finn på noe som ikke står i transkripsjonen. Transkripsjonen er maskinlaget og uten talernavn, så vær nøye med hvem som sier hva: ta bare med påstander du er rimelig sikker på at Karsan selv står for.
Sitater skal være på originalspråket og maks 15 ord.

Narrativet slik siden gjengir det (fra sekundærkilder, kan være feil):
{thesis}

Kravene siden følger nå:
{claims}

Fasene siden bruker:
{phases}"""

SCHEMA = {
    "type": "object",
    "properties": {
        "karsan_deltar": {"type": "boolean", "description": "Er Karsan faktisk gjest eller taler i episoden"},
        "oppsummering": {"type": "string", "description": "3 til 5 setninger om hovedbudskapet hans"},
        "pastander": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tema": {"type": "string"},
                    "pastand": {"type": "string", "description": "Hva Karsan sier, på norsk"},
                    "tall": {"type": "string", "description": "Konkrete tall eller nivåer, tom streng hvis ingen"},
                    "tidshorisont": {"type": "string", "description": "Tidsangivelse, tom streng hvis ingen"},
                    "sitat": {"type": "string", "description": "Kort sitat på originalspråket, maks 15 ord"},
                    "tid_sek": {"type": "number", "description": "Omtrentlig tidspunkt i sekunder, 0 hvis ukjent"},
                    "forhold": {"type": "string", "enum": ["bekrefter", "endrer", "nytt", "motsier"]},
                    "gjelder_krav": {"type": "string", "description": "id for kravet i listen, eller tom streng"},
                },
                "required": ["tema", "pastand", "tall", "tidshorisont", "sitat", "tid_sek", "forhold", "gjelder_krav"],
                "additionalProperties": False,
            },
        },
        "forslag": {
            "type": "array",
            "description": "Konkrete forslag til endringer i dashbordets krav, terskler, faser eller nye nøkkeltall",
            "items": {
                "type": "object",
                "properties": {
                    "hva": {"type": "string"},
                    "begrunnelse": {"type": "string"},
                },
                "required": ["hva", "begrunnelse"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["karsan_deltar", "oppsummering", "pastander", "forslag"],
    "additionalProperties": False,
}


def context():
    s = json.loads((CONFIG / "signals.json").read_text(encoding="utf-8"))
    claims = "\n".join(f"* {x['id']}: {x['title']}. {x['claim']}" for x in s["signals"])
    phases = "\n".join(f"* {p['name']}: {p['description']}" for p in s["regime"]["phases"])
    return SYSTEM.format(thesis=s["thesis"], claims=claims, phases=phases)


def clean(text):
    return text.replace("—", ",").replace("–", ",")


def analyze(ep, transcript):
    import anthropic
    client = anthropic.Anthropic()
    prompt = (f"Episode: {ep['title']} ({ep['show']}, {ep['date']}).\n\nTranskripsjon:\n{transcript}\n\n"
              "Finn det Karsan sier som er relevant for narrativet og kravene over: hva bekrefter, endrer, motsier "
              "eller legger til? Ta med tall og tidshorisonter. Foreslå konkrete endringer i dashbordet der det er grunnlag.")
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=context(),
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason == "refusal":
        raise RuntimeError("Modellen avslo forespørselen")
    res = json.loads("".join(b.text for b in msg.content if b.type == "text"))
    res["oppsummering"] = clean(res["oppsummering"])
    for p in res["pastander"]:
        for k in ("pastand", "tema", "tall", "tidshorisont"):
            p[k] = clean(p[k])
        words = p["sitat"].split()
        if len(words) > MAX_QUOTE_WORDS:
            p["sitat"] = " ".join(words[:MAX_QUOTE_WORDS]) + " ..."
    for f in res["forslag"]:
        f["hva"], f["begrunnelse"] = clean(f["hva"]), clean(f["begrunnelse"])
    return res, msg.model


# ---------- Hovedløkke ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-new", type=int, default=3, help="maks antall episoder som analyseres per kjøring")
    ap.add_argument("--reanalyze", default=None, help="episode-id som skal analyseres på nytt")
    args = ap.parse_args()

    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {"episodes": {}}
    eps = state["episodes"]
    for ep in discover() + discover_own_feeds():
        old = eps.get(ep["id"], {})
        eps[ep["id"]] = {**old, **{k: v for k, v in ep.items() if v is not None}}

    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    since = json.loads((CONFIG / "news.json").read_text(encoding="utf-8"))["karsan"].get("analyze_since", "0000")
    done = 0
    for ep in sorted(eps.values(), key=lambda e: e["date"], reverse=True):
        if done >= args.max_new:
            break
        if ep["date"] < since and ep["id"] != args.reanalyze:
            continue
        if ep.get("analysis") and ep["id"] != args.reanalyze:
            continue
        if ep.get("transcript_status") == "mangler" and ep["id"] != args.reanalyze and not os.environ.get("TRANSCRIBE_AUDIO"):
            continue
        try:
            text, source, url = get_transcript(ep)
        except Exception as e:
            ep["transcript_status"], ep["message"] = "feilet", f"Transkripsjon feilet: {e}"
            continue
        if not text:
            ep["transcript_status"] = "mangler"
            ep["message"] = "Ingen transkripsjon i feeden. Lydtranskribering er av (TRANSCRIBE_AUDIO)."
            continue
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / f"{ep['id']}.txt").write_text(text, encoding="utf-8")
        ep.update(transcript_status="ok", transcript_source=source, transcript_url=url, transcript_words=len(text.split()))
        if not has_key:
            ep["message"] = "Transkripsjon funnet. Analyse venter på ANTHROPIC_API_KEY."
            continue
        try:
            res, served = analyze(ep, text)
            ep.update(analysis=res, analyzed_at=now_iso(), model=served, message=None)
            done += 1
            print(f"Analysert: {ep['date']} {ep['title']}: {len(res['pastander'])} påstander, {len(res['forslag'])} forslag")
        except Exception as e:
            ep["message"] = f"Analyse feilet: {e}"
            print(f"Analyse feilet for {ep['title']}: {e}", file=sys.stderr)

    state["generated"] = now_iso()
    state["episodes"] = dict(sorted(eps.items(), key=lambda kv: kv[1]["date"], reverse=True))
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    n_ok = sum(1 for e in eps.values() if e.get("transcript_status") == "ok")
    n_an = sum(1 for e in eps.values() if e.get("analysis"))
    print(f"Podcastagent: {len(eps)} episoder, {n_ok} med transkripsjon, {n_an} analysert")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Podcastagent feilet: {e}", file=sys.stderr)
