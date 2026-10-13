"""Henter nyhetstitler og Karsans podcastopptredener til data/news.json.

Kilder (verifisert 2026-10-12):
  Google News RSS: https://news.google.com/rss/search?q=...&hl=en-US&gl=US&ceid=US:en
  Apple iTunes Search API: https://itunes.apple.com/search?term=...&entity=podcastEpisode
Bare tittel, kilde, dato og lenke lagres. Nye treff flettes inn i eksisterende
fil, eldre enn keep_days fjernes. Feil i ett søk beholder forrige treff.
Nyhetsfeil påvirker ikke dataseriene og feiler aldri workflowen.
"""
import json
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from common import CONFIG, DATA, http_get, now_iso

GNEWS = "https://news.google.com/rss/search?{qs}"
ITUNES = "https://itunes.apple.com/search?{qs}"


def gnews(query, lookback):
    url = GNEWS.format(qs=urllib.parse.urlencode({"q": f"{query} {lookback}", "hl": "en-US", "gl": "US", "ceid": "US:en"}))
    root = ET.fromstring(http_get(url))
    out = []
    for it in root.findall("./channel/item"):
        src = it.findtext("source") or ""
        title = (it.findtext("title") or "").strip()
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        d = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc).date().isoformat()
        out.append({"date": d, "title": title, "source": src, "link": it.findtext("link"), "kind": "nyhet"})
    return out, url


def itunes(term, match):
    url = ITUNES.format(qs=urllib.parse.urlencode({"term": term, "entity": "podcastEpisode", "limit": 50}))
    out = []
    for r in json.loads(http_get(url))["results"]:
        text = f"{r.get('trackName', '')} {r.get('description', '')}".lower()
        if match not in text:
            continue
        desc = " ".join((r.get("description") or r.get("shortDescription") or "").split())
        out.append({"date": r["releaseDate"][:10], "title": r.get("trackName", ""), "source": r.get("collectionName", ""),
                    "link": r.get("trackViewUrl") or r.get("collectionViewUrl"), "kind": "podcast",
                    "description": desc[:600]})
    return out, url


YOUTUBE = "https://www.youtube.com/feeds/videos.xml?channel_id={id}"


def youtube(channel_id, name):
    """Åpen RSS for en YouTube-kanal (Atom). Bare tittel, dato og lenke."""
    url = YOUTUBE.format(id=channel_id)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(http_get(url).encode("utf-8"))
    out = []
    for e in root.findall("a:entry", ns):
        link = e.find("a:link", ns)
        out.append({"date": (e.findtext("a:published", namespaces=ns) or "")[:10], "title": (e.findtext("a:title", namespaces=ns) or "").strip(),
                    "source": name, "link": link.attrib.get("href") if link is not None else None, "kind": "video"})
    return out, url


def merge(old, new, keep_days, cap):
    by_link = {x["link"]: x for x in old}
    for x in new:
        by_link[x["link"]] = x
    cutoff = (datetime.now(timezone.utc) - timedelta(days=keep_days)).date().isoformat()
    items = [x for x in by_link.values() if x["date"] >= cutoff]
    items.sort(key=lambda x: (x["date"], x["title"]), reverse=True)
    return items[:cap]


def main():
    cfg = json.loads((CONFIG / "news.json").read_text(encoding="utf-8"))
    path = DATA / "news.json"
    prev = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    out = {"generated": now_iso(), "sources": {}, "errors": [], "karsan": [], "topics": {}}
    keep, cap = cfg["keep_days"], cfg["max_per_topic"]

    k = cfg["karsan"]
    karsan_new = []
    sources = [("Google News", lambda: gnews(k["news_query"], cfg["lookback"])),
               ("Apple Podcasts", lambda: itunes(k["itunes_term"], k["itunes_match"]))]
    for yt in k.get("youtube", []):
        sources.append((yt["name"], lambda yt=yt: youtube(yt["channel_id"], yt["name"])))
    for name, fn in sources:
        try:
            items, url = fn()
            karsan_new += items
            out["sources"][f"karsan_{name}"] = url
        except Exception as e:
            out["errors"].append(f"Karsan, {name}: {e}")
    # Podcaster beholdes lenger enn nyheter: 365 dager
    out["karsan"] = merge(prev.get("karsan", []), karsan_new, 365, 90)

    for t in cfg["topics"]:
        try:
            items, url = gnews(t["query"], cfg["lookback"])
            out["sources"][t["id"]] = url
        except Exception as e:
            items = []
            out["errors"].append(f"{t['title']}: {e}")
        out["topics"][t["id"]] = merge(prev.get("topics", {}).get(t["id"], []), items, keep, cap)

    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Nyheter: Karsan {len(out['karsan'])}, temaer {sum(len(v) for v in out['topics'].values())}, feil {len(out['errors'])}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # nyheter skal aldri stoppe dataoppdateringen
        print(f"Nyhetshenting feilet: {e}")
