"""Henter FRED-serier fra config/series.json.

Primærkilde: FRED API (krever miljøvariabelen FRED_API_KEY).
Uten nøkkel brukes FREDs offentlige CSV-nedlasting (fredgraph.csv), som gir
samme observasjoner. Metoden som ble brukt lagres i status.json.
FRED bruker "." for manglende verdier: slike rader droppes.
"""
import csv
import io
import json
import os
import sys

from common import DATA, http_get, load_series, log_result, may_publish, skip_restricted, write_csv

START = "2015-01-01"
API = "https://api.stlouisfed.org/fred/series/observations?series_id={id}&file_type=json&observation_start={start}"
GRAPH = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={id}&cosd={start}"


def parse_api(text):
    rows = {}
    for o in json.loads(text)["observations"]:
        v = o["value"].strip()
        if v in (".", ""):
            continue
        rows[o["date"]] = float(v)
    return rows


def parse_graph(text, series_id):
    rows = {}
    reader = csv.DictReader(io.StringIO(text))
    date_col = reader.fieldnames[0]
    for r in reader:
        v = (r.get(series_id) or "").strip()
        if v in (".", ""):
            continue
        rows[r[date_col]] = float(v)
    return rows


def fetch(s, key):
    sid = s["source_id"]
    if key:
        public_url = API.format(id=sid, start=START)
        rows = parse_api(http_get(public_url + "&api_key=" + key))
        return rows, public_url, "FRED API"
    public_url = GRAPH.format(id=sid, start=START)
    return parse_graph(http_get(public_url), sid), public_url, "FRED fredgraph.csv (uten API-nøkkel)"


def main():
    key = os.environ.get("FRED_API_KEY", "").strip()
    ok = 0
    for s in load_series("fred"):
        if not may_publish(s):
            skip_restricted(s, GRAPH.format(id=s["source_id"], start=START))
            continue
        try:
            rows, url, method = fetch(s, key)
            if not rows:
                raise RuntimeError("Tomt svar")
            write_csv(DATA / f"{s['id']}.csv", rows)
            log_result(s["id"], True, url, method, len(rows))
            ok += 1
            print(f"{s['id']}: {len(rows)} rader, siste {max(rows)} = {rows[max(rows)]}")
        except Exception as e:
            log_result(s["id"], False, GRAPH.format(id=s["source_id"], start=START), message=str(e))
            print(f"{s['id']}: FEIL {e}", file=sys.stderr)
    print(f"FRED: {ok} serier oppdatert")


if __name__ == "__main__":
    main()
