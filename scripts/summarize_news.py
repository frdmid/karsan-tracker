"""Lager korte norske oppsummeringer av nyhetene med Claude API.

Kjøres bare hvis ANTHROPIC_API_KEY er satt. Uten nøkkel avslutter scriptet
stille, og siden viser overskrifter og episodebeskrivelser i stedet.

Per tema: 2 til 3 setninger om hovedbudskapet i overskriftene, pluss en
automatisk vurdering av om de peker i retning narrativet. Grunnlaget er bare
overskriftene, ikke artiklene, og det står på siden.
Per Karsan-podcast: 2 til 3 setninger fra utgiverens episodebeskrivelse.

Resultat i data/news_summary.json. En oppsummering lages bare på nytt når
grunnlaget (hash av inndata) er endret, så kostnaden holdes lav.
Feil skal aldri stoppe dataoppdateringen.
"""
import hashlib
import json
import os
import sys

from common import CONFIG, DATA, now_iso

MODEL = "claude-opus-5-5"
HEADLINES_PER_TOPIC = 20

SYSTEM = (
    "Du skriver korte, saklige oppsummeringer på norsk bokmål for en side som følger Cem Karsans "
    "makronarrativ. Narrativet: {thesis} "
    "Regler: bruk aldri tankestrek (verken lang eller kort), bruk komma, punktum eller kolon. "
    "Ingen emojier. Ikke finn på fakta som ikke står i grunnlaget. Hvis grunnlaget er tynt, si det."
)

TOPIC_SCHEMA = {
    "type": "object",
    "properties": {
        "oppsummering": {"type": "string", "description": "2 til 3 setninger om hovedbudskapet"},
        "retning": {"type": "string", "enum": ["bekrefter", "avkrefter", "blandet", "uklart"]},
    },
    "required": ["oppsummering", "retning"],
    "additionalProperties": False,
}
PODCAST_SCHEMA = {
    "type": "object",
    "properties": {"oppsummering": {"type": "string", "description": "2 til 3 setninger"}},
    "required": ["oppsummering"],
    "additionalProperties": False,
}


def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def ask(client, system, prompt, schema):
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=2000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Modellen avslo forespørselen")
    text = "".join(b.text for b in response.content if b.type == "text")
    return json.loads(text), response.model


def clean(text):
    # Sikrer regelen om ingen tankestrek også om modellen bommer.
    return text.replace("—", ",").replace("–", ",")


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY er ikke satt, hopper over oppsummering")
        return
    import anthropic

    client = anthropic.Anthropic()
    signals = json.loads((CONFIG / "signals.json").read_text(encoding="utf-8"))
    cfg = json.loads((CONFIG / "news.json").read_text(encoding="utf-8"))
    news = json.loads((DATA / "news.json").read_text(encoding="utf-8"))
    path = DATA / "news_summary.json"
    prev = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    out = {"generated": now_iso(), "model": MODEL, "topics": {}, "podcasts": {}, "errors": []}
    system = SYSTEM.format(thesis=signals["thesis"])

    for t in cfg["topics"]:
        items = news.get("topics", {}).get(t["id"], [])[:HEADLINES_PER_TOPIC]
        basis = [f"{x['date']}: {x['title']} ({x['source']})" for x in items]
        h = digest(basis)
        old = prev.get("topics", {}).get(t["id"])
        if old and old.get("hash") == h:
            out["topics"][t["id"]] = old
            continue
        if not basis:
            continue
        prompt = (f"Tema: {t['title']}. Under er de nyeste nyhetsoverskriftene (bare titler, ikke artikler).\n\n"
                  + "\n".join(basis)
                  + "\n\nOppsummer hovedbudskapet i 2 til 3 setninger. Vurder om overskriftene samlet "
                    "bekrefter eller avkrefter narrativet, eller om bildet er blandet eller uklart.")
        try:
            res, served = ask(client, system, prompt, TOPIC_SCHEMA)
            out["topics"][t["id"]] = {"hash": h, "summary": clean(res["oppsummering"]), "direction": res["retning"],
                                      "based_on": len(basis), "generated": now_iso(), "model": served}
        except Exception as e:
            out["errors"].append(f"{t['title']}: {e}")
            if old:
                out["topics"][t["id"]] = old

    for x in news.get("karsan", []):
        if x.get("kind") != "podcast" or not x.get("description"):
            continue
        h = digest([x["title"], x["description"]])
        old = prev.get("podcasts", {}).get(x["link"])
        if old and old.get("hash") == h:
            out["podcasts"][x["link"]] = old
            continue
        prompt = (f"Podcastepisode: {x['title']} ({x['source']}, {x['date']}).\nUtgiverens beskrivelse: {x['description']}\n\n"
                  "Oppsummer i 2 til 3 setninger hva Karsan ifølge beskrivelsen tar opp, med vekt på det som berører narrativet.")
        try:
            res, served = ask(client, system, prompt, PODCAST_SCHEMA)
            out["podcasts"][x["link"]] = {"hash": h, "summary": clean(res["oppsummering"]), "generated": now_iso(), "model": served}
        except Exception as e:
            out["errors"].append(f"{x['title']}: {e}")
            if old:
                out["podcasts"][x["link"]] = old

    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Oppsummert: {len(out['topics'])} temaer, {len(out['podcasts'])} podcaster, feil {len(out['errors'])}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Oppsummering feilet: {e}", file=sys.stderr)
