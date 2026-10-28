"""Lagrer en analyse av en Karsan-episode laget manuelt i Claude Code.

Arbeidsflyt (se README, "Analyse av nye episoder"):
  1. python scripts/podcast_agent.py --list    viser episoder som venter, henter transkripsjon til build/transcripts/
  2. Claude leser build/transcripts/<id>.txt og skriver analysen som JSON (samme skjema som agenten)
  3. python scripts/lagre_analyse.py <id> <analyse.json>
  4. commit og push data/karsan_episodes.json

Sjekker at feltene finnes, kutter sitater til 15 ord og fjerner tankestreker.
Transkripsjonen lagres aldri i repoet.
"""
import json
import sys

from common import DATA, now_iso

MAX_QUOTE_WORDS = 15
REL = {"bekrefter", "endrer", "nytt", "motsier"}


def clean(t):
    return (t or "").replace("—", ",").replace("–", ",")


def main():
    if len(sys.argv) < 3:
        sys.exit("Bruk: python scripts/lagre_analyse.py <episode-id> <analyse.json> [modellnavn]")
    eid, src = sys.argv[1], sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else "Claude i Claude Code (manuell analyse)"
    path = DATA / "karsan_episodes.json"
    state = json.loads(path.read_text(encoding="utf-8"))
    if eid not in state["episodes"]:
        sys.exit(f"Fant ikke episode {eid}")
    a = json.loads(open(src, encoding="utf-8").read())
    # Valgfritt: annen transkripsjonskilde enn feeden, for eksempel YouTube lest i nettleser.
    source, source_url = a.pop("transkripsjon_kilde", None), a.pop("transkripsjon_url", None)
    # Valgfritt: ny tittel og lenke, for eksempel når flere klipp analyseres samlet.
    title, link = a.pop("tittel", None), a.pop("lenke", None)
    for k in ("karsan_deltar", "oppsummering", "pastander", "forslag"):
        if k not in a:
            sys.exit(f"Mangler felt: {k}")
    a["oppsummering"] = clean(a["oppsummering"])
    for p in a["pastander"]:
        for k in ("tema", "pastand", "tall", "tidshorisont", "sitat", "gjelder_krav"):
            p[k] = clean(p.get(k, ""))
        p.setdefault("tid_sek", 0)
        if p.get("forhold") not in REL:
            sys.exit(f"Ugyldig forhold: {p.get('forhold')}")
        words = p["sitat"].split()
        if len(words) > MAX_QUOTE_WORDS:
            p["sitat"] = " ".join(words[:MAX_QUOTE_WORDS]) + " ..."
    for f in a["forslag"]:
        f["hva"], f["begrunnelse"] = clean(f["hva"]), clean(f["begrunnelse"])
    ep = state["episodes"][eid]
    ep.update(analysis=a, analyzed_at=now_iso(), model=model, message=None)
    if source:
        ep.update(transcript_status="ok", transcript_source=source, transcript_url=source_url)
    # Egne felt, så agentens oppdagelse (som skriver title og link fra Apple) ikke overskriver dem.
    if title:
        ep["display_title"] = title
    if link:
        ep["display_link"] = link
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Lagret analyse for {ep.get('display_title') or ep['title']}: {len(a['pastander'])} påstander, {len(a['forslag'])} forslag")


if __name__ == "__main__":
    main()
