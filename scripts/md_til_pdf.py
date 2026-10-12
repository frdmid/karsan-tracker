"""Lager PDF av en Markdown-fil (PROSJEKT.md, LOGG.md, README.md).

Enkel omformer for det Markdown-utvalget prosjektets dokumenter bruker:
overskrifter, avsnitt, punkt- og nummerlister, tabeller, kodeblokker,
inline kode, fet tekst og lenker. HTML skrives ut til PDF med Microsoft Edge
i headless modus.

Bruk: python scripts/md_til_pdf.py PROSJEKT.md
"""
import html
import re
import subprocess
import sys
from pathlib import Path

EDGE = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"]

CSS = """
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
body { font: 10.5pt/1.5 "Segoe UI", system-ui, sans-serif; color: #111; }
h1 { font-size: 20pt; margin: 0 0 8pt; }
h2 { font-size: 13.5pt; margin: 18pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li { margin: 0 0 2pt; }
code { font: 9pt Consolas, monospace; background: #f2f2f0; padding: 0 2pt; border-radius: 2pt; }
pre { font: 8.5pt/1.4 Consolas, monospace; background: #f6f6f4; border: 1px solid #e2e2de; padding: 7pt 9pt; border-radius: 4pt; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt; font-size: 9pt; font-variant-numeric: tabular-nums; break-inside: auto; }
th, td { border: 1px solid #d6d6d0; padding: 3pt 5pt; text-align: left; vertical-align: top; word-break: break-word; }
th { background: #f0f0ec; }
tr { break-inside: avoid; }
a { color: #1c5cab; text-decoration: none; }
"""


def inline(text):
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append(f"<code>{html.escape(p[1:-1])}</code>")
            continue
        s = html.escape(p, quote=False)
        s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r"(?<![\"=>])(https?://[^\s<)]+)", r'<a href="\1">\1</a>', s)
        out.append(s)
    return "".join(out)


def convert(md):
    lines = md.splitlines()
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            buf = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            out.append("<pre><code>" + html.escape("\n".join(buf)) + "</code></pre>")
            i += 1
            continue
        m = re.match(r"(#{1,6})\s+(.*)", line)
        if m:
            n = len(m.group(1))
            out.append(f"<h{n}>{inline(m.group(2))}</h{n}>")
            i += 1
            continue
        if line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            head, body = rows[0], [r for r in rows[1:] if not all(re.fullmatch(r":?-+:?", c) for c in r)]
            out.append("<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                       + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body)
                       + "</tbody></table>")
            continue
        if re.match(r"\s*[*-]\s+", line) or re.match(r"\s*\d+\.\s+", line):
            ordered = bool(re.match(r"\s*\d+\.\s+", line))
            tag = "ol" if ordered else "ul"
            items = []
            while i < len(lines) and (re.match(r"\s*([*-]|\d+\.)\s+", lines[i]) or (lines[i].startswith("   ") and lines[i].strip())):
                m2 = re.match(r"(\s*)([*-]|(\d+)\.)\s+(.*)", lines[i])
                if m2 and len(m2.group(1)) == 0:
                    items.append([m2.group(4), [], m2.group(3)])
                elif items:
                    sub = re.match(r"\s*[*-]\s+(.*)", lines[i])
                    items[-1][1].append(sub.group(1) if sub else lines[i].strip())
                i += 1
            start = f' start="{items[0][2]}"' if ordered and items and items[0][2] not in (None, "1") else ""
            out.append(f"<{tag}{start}>" + "".join(
                f"<li>{inline(t)}" + ("<ul>" + "".join(f"<li>{inline(s)}</li>" for s in subs) + "</ul>" if subs else "") + "</li>"
                for t, subs, _ in items) + f"</{tag}>")
            continue
        if not line.strip():
            i += 1
            continue
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r"(#|```|\||\s*[*-]\s|\s*\d+\.\s)", lines[i]):
            buf.append(lines[i].strip())
            i += 1
        out.append(f"<p>{inline(' '.join(buf))}</p>")
    return "\n".join(out)


def main():
    src = Path(sys.argv[1]).resolve()
    title = src.stem
    body = convert(src.read_text(encoding="utf-8"))
    html_path = src.with_suffix(".print.html")
    html_path.write_text(f'<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>{title}</title>'
                         f"<style>{CSS}</style></head><body>{body}</body></html>", encoding="utf-8")
    pdf_path = src.with_suffix(".pdf")
    edge = next((e for e in EDGE if Path(e).exists()), None)
    if not edge:
        sys.exit("Fant ikke Microsoft Edge")
    subprocess.run([edge, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}", html_path.as_uri()], check=True, timeout=120)
    html_path.unlink()
    print(pdf_path)


if __name__ == "__main__":
    main()
