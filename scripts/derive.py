"""Serier regnet ut fra andre serier i data/, med samme dato i begge.

UST_BE_10Y = UST_10Y minus UST_REAL_10Y. Det er definisjonen FRED bruker for T10YIE
(10 års nominell rente minus 10 års TIPS rente, konstant løpetid). Verifisert 2026-11-06:
lik T10YIE på alle 1712 felles datoer siden 2020, og Treasury publiserer en dag før FRED.
Kryssjekkes mot T10YIE i build_status.py.
"""
import sys

from common import DATA, load_series, log_result, read_csv, write_csv


def main():
    ok = 0
    for s in load_series("derived"):
        try:
            a_id, b_id = s["source_id"].split("-")
            a, b = read_csv(DATA / f"{a_id}.csv"), read_csv(DATA / f"{b_id}.csv")
            rows = {d: round(a[d] - b[d], 4) for d in a if d in b}
            if not rows:
                raise RuntimeError("Ingen felles datoer")
            write_csv(DATA / f"{s['id']}.csv", rows)
            log_result(s["id"], True, s["source_id"], "Utregnet fra Treasury-seriene", len(rows))
            ok += 1
            last = max(rows)
            print(f"{s['id']}: {len(rows)} rader, siste {last} = {rows[last]}")
        except Exception as e:
            log_result(s["id"], False, s["source_id"], message=str(e))
            print(f"{s['id']}: FEIL {e}", file=sys.stderr)
    print(f"Utregnede serier: {ok}")


if __name__ == "__main__":
    main()
