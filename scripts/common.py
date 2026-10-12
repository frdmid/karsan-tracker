"""Felles hjelpefunksjoner for hentescriptene.

Hvert hentescript skriver data/<id>.csv (date,value, stigende ISO-datoer) og
legger et resultat per serie i build/fetch_log.json. build_status.py leser
loggen og lager data/status.json.
"""
import csv
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = ROOT / "config"
LOG = ROOT / "build" / "fetch_log.json"
UA = "karsan-tracker (github.com; datainnhenting for offentlig statusside)"


def load_series(source=None):
    with open(CONFIG / "series.json", encoding="utf-8") as f:
        items = json.load(f)["series"]
    return [s for s in items if source is None or s["source"] == source]


def may_publish(series):
    """Serier med publish=false hentes bare når PUBLISH_RESTRICTED=true."""
    if series.get("publish", True):
        return True
    return os.environ.get("PUBLISH_RESTRICTED", "").lower() == "true"


def http_get(url, retries=3, timeout=60):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8-sig")
        except urllib.error.HTTPError as e:
            last = e
            if 400 <= e.code < 500 and e.code != 429:
                break
        except Exception as e:  # nettverksfeil, timeout
            last = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Henting feilet: {redact(str(last))}")


def redact(text):
    key = os.environ.get("FRED_API_KEY")
    return text.replace(key, "***") if key else text


def read_csv(path):
    rows = {}
    if not Path(path).exists():
        return rows
    with open(path, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            rows[r["date"]] = float(r["value"])
    return rows


def write_csv(path, rows):
    """rows: dict dato -> verdi. Skrives sortert stigende."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["date", "value"])
        for d in sorted(rows):
            w.writerow([d, repr_value(rows[d])])
    tmp.replace(path)


def repr_value(v):
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def log_result(series_id, ok, source_url, method=None, rows=None, message=None, skipped=False):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    log = {}
    if LOG.exists():
        log = json.loads(LOG.read_text(encoding="utf-8"))
    log[series_id] = {
        "ok": ok,
        "skipped": skipped,
        "fetched_at": now_iso(),
        "source_url": source_url,
        "method": method,
        "rows": rows,
        "message": redact(message) if message else None,
    }
    LOG.write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")


def skip_restricted(s, source_url):
    log_result(s["id"], ok=False, skipped=True, source_url=source_url,
               message="Ikke hentet: lisensen tillater ikke publisering i offentlig repo (publish=false).")
    print(f"{s['id']}: hoppet over (publish=false)")
