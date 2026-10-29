"""Henter serier direkte fra originalkilden når den er ferskere enn FRED.

Verifisert 2026-10-15:
  Cboe:        https://cdn.cboe.com/api/global/us_indices/daily_prices/{SYM}_History.csv
               VIX har kolonnene DATE,OPEN,HIGH,LOW,CLOSE, OVX og GVZ har DATE,{SYM}.
               Dato MM/DD/YYYY. Samme sluttkurs som FRED VIXCLS, OVXCLS og GVZCLS, men en dag før.
  Norges Bank: https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=csv&startPeriod=2015-01-01&locale=en
               Semikolonseparert, kolonnene TIME_PERIOD og OBS_VALUE. Åpne data fra Norges Bank.
               Fem dager ferskere enn FRED DEXNOUS (som publiseres ukentlig). Merk: Norges Banks
               kurs settes rundt kl. 14:15 i Oslo, FRED bruker kursen kl. 12 i New York.

Feil i én serie beholder forrige fil, som i de andre hentescriptene.
"""
import csv
import io
import sys

from common import DATA, http_get, load_series, log_result, read_csv, write_csv

CBOE = "https://cdn.cboe.com/api/global/us_indices/daily_prices/{sym}_History.csv"
NB = "https://data.norges-bank.no/api/data/EXR/{key}?format=csv&startPeriod=2015-01-01&locale=en"


def iso(mdy):
    m, d, y = mdy.split("/")
    return f"{y}-{int(m):02d}-{int(d):02d}"


def fetch_cboe(sym):
    url = CBOE.format(sym=sym)
    reader = csv.DictReader(io.StringIO(http_get(url)))
    col = "CLOSE" if "CLOSE" in reader.fieldnames else sym
    rows = {}
    for r in reader:
        v = (r.get(col) or "").strip()
        if v:
            d = iso(r["DATE"])
            if d >= "2015-01-01":
                rows[d] = float(v)
    return rows, url


def fetch_norgesbank(key):
    url = NB.format(key=key)
    reader = csv.DictReader(io.StringIO(http_get(url)), delimiter=";")
    rows = {}
    for r in reader:
        v = (r.get("OBS_VALUE") or "").strip()
        if v:
            rows[r["TIME_PERIOD"]] = float(v)
    return rows, url


OFR = "https://www.financialresearch.gov/financial-stress-index/data/fsi.csv"


def fetch_ofr(column):
    """OFR Financial Stress Index. Verifisert 2026-10-28: kolonnene Date (ISO), OFR FSI, Credit, Equity valuation, Safe assets, Funding, Volatility."""
    reader = csv.DictReader(io.StringIO(http_get(OFR)))
    rows = {}
    for r in reader:
        v = (r.get(column) or "").strip()
        if v and r["Date"] >= "2015-01-01":
            rows[r["Date"]] = float(v)
    return rows, OFR


FETCHERS = {"cboe": fetch_cboe, "norgesbank": fetch_norgesbank, "ofr": fetch_ofr}


def main():
    ok = 0
    for s in load_series():
        fn = FETCHERS.get(s["source"])
        if not fn:
            continue
        try:
            rows, url = fn(s["source_id"])
            if not rows:
                raise RuntimeError("Ingen rader")
            path = DATA / f"{s['id']}.csv"
            merged = read_csv(path)
            merged.update(rows)
            write_csv(path, merged)
            log_result(s["id"], True, url, {"cboe": "Cboe CSV", "norgesbank": "Norges Bank API", "ofr": "OFR CSV"}[s["source"]], len(merged))
            ok += 1
            last = max(merged)
            print(f"{s['id']}: {len(merged)} rader, siste {last} = {merged[last]}")
        except Exception as e:
            log_result(s["id"], False, s["source_id"], message=str(e))
            print(f"{s['id']}: FEIL {e}", file=sys.stderr)
    print(f"Direkte kilder: {ok} serier oppdatert")


if __name__ == "__main__":
    main()
