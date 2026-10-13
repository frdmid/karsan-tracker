"""Bygger en kopi av siden for publisering som Claude-artifact i build/artifact.

Kopierer site/, config/ og offentlige data/ (aldri private/), og bytter
__VERSION__ med gjeldende commit-id slik pages.yml gjør for GitHub Pages.
Bruk: python scripts/bygg_artifact.py
"""
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "artifact"


def main():
    try:
        version = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except FileNotFoundError:
        version = ""
    version = version or "lokal"
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT / "site", OUT)
    shutil.copytree(ROOT / "config", OUT / "config")
    (OUT / "data").mkdir()
    for f in (ROOT / "data").iterdir():
        if f.suffix in (".csv", ".json"):
            shutil.copy2(f, OUT / "data" / f.name)
    for rel in ("index.html", "js/app.js"):
        p = OUT / rel
        p.write_text(p.read_text(encoding="utf-8").replace("__VERSION__", version), encoding="utf-8")
    files = sorted(str(p.relative_to(OUT)).replace("\\", "/") for p in OUT.rglob("*") if p.is_file())
    print(f"versjon {version}, {len(files)} filer")
    for f in files:
        print(f)


if __name__ == "__main__":
    main()
