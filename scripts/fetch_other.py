"""Henter serier fra uoffisielle kilder (Yahoo Finance chart API).

Verifisert 2026-10-12: ^MOVE og GC=F svarer. Verifisert 2026-11-02: CL=F (WTI nærmeste future, NYMEX)
og DX-Y.NYB (ICE US Dollar Index) svarer, historikk fra 2016. Stooq (gull) krever nå
JavaScript-verifisering og virker ikke fra script.
Alle seriene har publish=false fordi Yahoos vilkår ikke tillater
videredistribusjon. De hentes bare med PUBLISH_RESTRICTED=true.
Uoffisielt endepunkt: kan slutte å virke uten varsel.
"""
import json
import sys
import urllib.parse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from common import DATA, http_get, load_series, log_result, may_publish, read_csv, skip_restricted, write_csv

URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=10y&interval=1d"


def parse_yahoo(text):
    res = json.loads(text)["chart"]["result"][0]
    # Børsens tidssone per tidsstempel. meta.gmtoffset er dagens forskyvning og ga feil dato
    # for alle dager med sommertid etter overgangen til vintertid 1. nov. 2026.
    tz = ZoneInfo(res["meta"].get("exchangeTimezoneName") or "America/New_York")
    closes = res["indicators"]["quote"][0]["close"]
    # Dagens bar er en løpende kurs, ikke sluttkurs, mens handelsdagen pågår. Den tas ikke med.
    regular = (res["meta"].get("currentTradingPeriod") or {}).get("regular") or {}
    today = datetime.now(tz).date().isoformat()
    session_open = regular.get("end", 0) > datetime.now(timezone.utc).timestamp()
    rows = {}
    for ts, v in zip(res["timestamp"], closes):
        d = datetime.fromtimestamp(ts, tz=tz).date().isoformat()
        if v is None or (session_open and d == today):
            continue
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
