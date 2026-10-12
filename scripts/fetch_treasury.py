"""Henter daglige renter fra home.treasury.gov som uavhengig kryssjekk.

Henter inneværende og forrige år og fletter inn i eksisterende CSV.
Bruk --from-year ÅR for å bygge historikk første gang.
Kolonnenavn verifisert 2026-10-12: "Date", "2 Yr", "5 Yr", "10 Yr", "20 Yr",
"30 Yr" (daily_treasury_yield_curve) og "LT Real Average (10> Yrs)"
(daily_treasury_real_long_term). Datoformat MM/DD/YYYY.
"""
import argparse
import csv
import io
import sys
from datetime import date

from common import DATA, http_get, load_series, log_result, read_csv, write_csv

URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
       "daily-treasury-rates.csv/{year}/all?type={type}&field_tdr_date_value={year}&page&_format=csv")


def iso(mdy):
    m, d, y = mdy.split("/")
    return f"{y}-{int(m):02d}-{int(d):02d}"


def parse(text, column):
    rows = {}
    reader = csv.DictReader(io.StringIO(text))
    if column not in (reader.fieldnames or []):
        raise RuntimeError(f"Kolonnen '{column}' finnes ikke. Kolonner: {reader.fieldnames}")
    for r in reader:
        v = (r.get(column) or "").strip()
        if v in ("", "N/A"):
            continue
        rows[iso(r["Date"])] = float(v)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-year", type=int, default=None)
    args = ap.parse_args()
    this_year = date.today().year
    years = list(range(args.from_year or this_year - 1, this_year + 1))

    series = load_series("treasury")
    texts = {}  # (type, år) -> tekst eller Exception
    for t in sorted({s["source_id"] for s in series}):
        for y in years:
            try:
                texts[(t, y)] = http_get(URL.format(year=y, type=t))
            except Exception as e:
                texts[(t, y)] = e

    ok = 0
    for s in series:
        t = s["source_id"]
        url = URL.format(year=this_year, type=t)
        try:
            new = {}
            for y in years:
                txt = texts[(t, y)]
                if isinstance(txt, Exception):
                    raise txt
                new.update(parse(txt, s["column"]))
            if not new:
                raise RuntimeError("Ingen rader")
            path = DATA / f"{s['id']}.csv"
            merged = read_csv(path)
            merged.update(new)
            write_csv(path, merged)
            log_result(s["id"], True, url, "Treasury CSV", len(merged))
            ok += 1
            last = max(merged)
            print(f"{s['id']}: {len(merged)} rader, siste {last} = {merged[last]}")
        except Exception as e:
            log_result(s["id"], False, url, message=str(e))
            print(f"{s['id']}: FEIL {e}", file=sys.stderr)
    print(f"Treasury: {ok} serier oppdatert")


if __name__ == "__main__":
    main()
