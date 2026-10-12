"""Bygger data/status.json fra build/fetch_log.json og CSV-filene.

Status per serie:
  ok              hentet nå, siste observasjon innenfor max_age_days
  utdatert        siste observasjon eldre enn max_age_days, eller hentingen
                  feilet og forrige fil er beholdt
  feilet          hentingen feilet og det finnes ingen tidligere fil
  ikke_publisert  publish=false i config/series.json (lisens)

Kryssjekk: FRED DGSn mot Treasury par yield samme dato. Avvik over
0,01 prosentpoeng gir advarsel.

Avslutter med feilkode bare hvis ALLE forsøkte hentinger feilet.
"""
import json
import sys
from datetime import date

from common import DATA, LOG, load_series, now_iso, read_csv

TOLERANCE = 0.01
CROSS_PAIRS = [("DGS2", "UST_2Y"), ("DGS5", "UST_5Y"), ("DGS10", "UST_10Y"),
               ("DGS20", "UST_20Y"), ("DGS30", "UST_30Y")]
CROSS_WINDOW = 60  # siste N felles datoer som sjekkes


def crosscheck():
    warnings, checks = [], []
    for fred_id, ust_id in CROSS_PAIRS:
        a, b = read_csv(DATA / f"{fred_id}.csv"), read_csv(DATA / f"{ust_id}.csv")
        common = sorted(set(a) & set(b))[-CROSS_WINDOW:]
        bad = [d for d in common if abs(a[d] - b[d]) > TOLERANCE + 1e-9]
        checks.append({"fred": fred_id, "treasury": ust_id, "dates_checked": len(common),
                       "from": common[0] if common else None, "to": common[-1] if common else None,
                       "deviations": len(bad)})
        for d in bad:
            warnings.append({"type": "kryssjekk", "fred": fred_id, "treasury": ust_id, "date": d,
                             "fred_value": a[d], "treasury_value": b[d],
                             "diff": round(a[d] - b[d], 4),
                             "message": f"{fred_id} og {ust_id} avviker med {abs(a[d] - b[d]):.2f} prosentpoeng {d}"})
    return checks, warnings


def main():
    today = date.today()
    log = json.loads(LOG.read_text(encoding="utf-8")) if LOG.exists() else {}
    prev_path = DATA / "status.json"
    prev = json.loads(prev_path.read_text(encoding="utf-8")).get("series", {}) if prev_path.exists() else {}

    out = {}
    for s in load_series():
        sid = s["id"]
        path = DATA / f"{sid}.csv"
        rows = read_csv(path)
        entry = log.get(sid)
        p = prev.get(sid, {})
        last_obs = max(rows) if rows else None
        age = (today - date.fromisoformat(last_obs)).days if last_obs else None
        rec = {
            "source": s["source"],
            "source_id": s["source_id"],
            "title": s["title"],
            "last_fetched": p.get("last_fetched"),
            "last_observation": last_obs,
            "age_days": age,
            "max_age_days": s["max_age_days"],
            "rows": len(rows),
            "source_url": (entry or p).get("source_url"),
            "method": p.get("method"),
            "license": s.get("license"),
            "unofficial": bool(s.get("unofficial")),
            "message": None,
        }
        if entry and entry.get("skipped"):
            rec["status"] = "ikke_publisert"
            rec["message"] = entry["message"]
        elif entry and entry["ok"]:
            rec["last_fetched"] = entry["fetched_at"]
            rec["method"] = entry["method"]
            rec["status"] = "ok" if age is not None and age <= s["max_age_days"] else "utdatert"
        elif rows:
            rec["status"] = "utdatert" if entry else ("ok" if age <= s["max_age_days"] else "utdatert")
            if entry:
                rec["message"] = "Siste henting feilet, forrige fil er beholdt: " + (entry.get("message") or "")
        else:
            rec["status"] = "feilet" if entry else ("ikke_publisert" if not s.get("publish", True) else "feilet")
            rec["message"] = (entry or {}).get("message") or "Ingen data"
        if rec["status"] == "utdatert" and not rec["message"] and age is not None:
            rec["message"] = f"Siste observasjon er {age} dager gammel, grense {s['max_age_days']}"
        out[sid] = rec

    checks, warnings = crosscheck()
    status = {"generated": now_iso(), "series": out, "crosscheck": checks, "warnings": warnings}
    prev_path.write_text(json.dumps(status, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    attempted = [e for e in log.values() if not e.get("skipped")]
    failed = [k for k, e in log.items() if not e.get("skipped") and not e["ok"]]
    for k in failed:
        print(f"FEILET: {k}: {log[k].get('message')}", file=sys.stderr)
    for w in warnings:
        print(f"ADVARSEL: {w['message']}", file=sys.stderr)
    print(f"Status: {sum(r['status'] == 'ok' for r in out.values())} ok, "
          f"{sum(r['status'] == 'utdatert' for r in out.values())} utdatert, "
          f"{sum(r['status'] == 'feilet' for r in out.values())} feilet, "
          f"{sum(r['status'] == 'ikke_publisert' for r in out.values())} ikke publisert")
    if not attempted or len(failed) == len(attempted):
        print("Alle serier feilet", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
