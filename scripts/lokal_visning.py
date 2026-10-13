"""Privat lokal visning med lisensbegrensede serier.

Henter seriene med publish=false (S&P 500, ICE OAS, MOVE, gull) til mappen
private/, som aldri committes (.gitignore). Starter deretter en lokal
webserver og åpner siden. Siden leser private/ bare når den finnes, og viser
da et banner om at visningen er privat.

Bruk: python scripts/lokal_visning.py   (eller dobbeltklikk "Karsan lokal.cmd")
Valg: --no-serve henter bare data.  --no-pull hopper over git pull.
"""
import argparse
import http.server
import json
import os
import subprocess
import sys
import threading
import webbrowser
from functools import partial

from common import ROOT, http_get, load_series, now_iso, write_csv
from fetch_fred import fetch as fetch_fred
from fetch_other import URL as YAHOO_URL, parse_yahoo

PRIVATE = ROOT / "private"
PORT = 8765


def pull():
    try:
        r = subprocess.run(["git", "pull", "--ff-only", "-q"], cwd=ROOT, capture_output=True, text=True, timeout=60)
        print("Offentlige data oppdatert fra GitHub" if r.returncode == 0 else f"git pull feilet, bruker lokale data: {r.stderr.strip()}")
    except Exception as e:
        print(f"git pull ikke tilgjengelig, bruker lokale data: {e}")


def fetch_private():
    import urllib.parse
    key = os.environ.get("FRED_API_KEY", "").strip()
    status = {"generated": now_iso(), "series": {}}
    for s in load_series():
        if s.get("publish", True):
            continue
        try:
            if s["source"] == "fred":
                rows, url, method = fetch_fred(s, key)
            elif s["source"] == "yahoo":
                url = YAHOO_URL.format(sym=urllib.parse.quote(s["source_id"], safe=""))
                rows, method = parse_yahoo(http_get(url)), "Yahoo chart API (uoffisiell)"
            else:
                continue
            write_csv(PRIVATE / "data" / f"{s['id']}.csv", rows)
            last = max(rows)
            status["series"][s["id"]] = {"status": "ok", "rows": len(rows), "last_observation": last,
                                         "last_fetched": now_iso(), "source_url": url, "method": method,
                                         "message": "Privat lokal visning, ikke publisert"}
            print(f"{s['id']}: {len(rows)} rader, siste {last} = {rows[last]}")
        except Exception as e:
            status["series"][s["id"]] = {"status": "feilet", "rows": 0, "message": f"Privat henting feilet: {e}"}
            print(f"{s['id']}: FEIL {e}", file=sys.stderr)
    (PRIVATE / "status.json").write_text(json.dumps(status, indent=2, ensure_ascii=False), encoding="utf-8")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Ber nettleseren alltid hente filene på nytt, så endringer synes uten Ctrl+F5."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve():
    handler = partial(NoCacheHandler, directory=str(ROOT))
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError:
        print(f"Port {PORT} er i bruk, antar at serveren allerede kjører")
        webbrowser.open(f"http://127.0.0.1:{PORT}/site/")
        return
    url = f"http://127.0.0.1:{PORT}/site/"
    print(f"Siden kjører på {url}. Lukk vinduet eller trykk Ctrl+C for å stoppe.")
    threading.Timer(1.0, webbrowser.open, args=[url]).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-serve", action="store_true")
    ap.add_argument("--no-pull", action="store_true")
    args = ap.parse_args()
    if not args.no_pull:
        pull()
    fetch_private()
    if not args.no_serve:
        serve()


if __name__ == "__main__":
    main()
