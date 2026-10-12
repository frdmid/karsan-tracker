"""Henter serier fra uoffisielle kilder (Yahoo Finance chart API).

Verifisert 2026-10-12: ^MOVE og GC=F svarer. Stooq (gull) krever nå
JavaScript-verifisering og virker ikke fra script.
Begge seriene har publish=false fordi Yahoos vilkår ikke tillater
videredistribusjon. De hentes bare med PUBLISH_RESTRICTED=true.
Uoffisielt endepunkt: kan slutte å virke uten varsel.
"""
import json
import sys
import urllib.parse
from datetime import datetime, timezone

from common import DATA, http_get, load_series, log_result, may_publish, read_csv, skip_restricted, write_csv

URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=10y&interval=1d"


def parse_yahoo(text):
    res = json.loads(text)["chart"]["result"][0]
    tz_offset = res["meta"].get("gmtoffset", 0)
    closes = res["indicators"]["quote"][0]["close"]
    rows = {}
    for ts, v in zip(res["timestamp"], closes):
        if v is None:
            continue
        d = datetime.fromtimestamp(ts + tz_offset, tz=timezone.utc).date().isoformat()
        rows[d] = round(float(v), 4)
    return rows


def main():
    ok = 0
    for s in load_series("yahoo"):
        url = URL.format(sym=urllib.parse.quote(s["source_id"], safe=""))
        if not may_publish(s):
            skip_restricted(s, url)
            continue
        try:
            new = parse_yahoo(http_get(url))
            if not new:
                raise RuntimeError("Ingen rader")
            path = DATA / f"{s['id']}.csv"
            merged = read_csv(path)
            merged.update(new)
            write_csv(path, merged)
            log_result(s["id"], True, url, "Yahoo chart API (uoffisiell)", len(merged))
            ok += 1
        except Exception as e:
            log_result(s["id"], False, url, message=str(e))
            print(f"{s['id']}: FEIL {e}", file=sys.stderr)
    print(f"Uoffisielle kilder: {ok} serier oppdatert")


if __name__ == "__main__":
    main()
