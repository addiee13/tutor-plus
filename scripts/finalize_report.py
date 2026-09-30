"""Build the DOCX, convert it to PDF with LibreOffice, and iterate until the TOC page numbers are stable."""
import json
import subprocess
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/doc"
NAME = "Adam_Dalwai_Group11_Sprint2"


def page_map(pdf):
    headings = json.loads((OUT / "headings.json").read_text())
    document = pymupdf.open(pdf)
    lines = [[line.strip() for line in page.get_text().splitlines()] for page in document]
    start = next(i for i, page in enumerate(lines) if "TABLE OF CONTENTS" in page)
    body_start = start + 1
    while any("\t" in line or line.endswith(tuple("0123456789")) and "...." in line for line in lines[body_start]):
        body_start += 1
    result, cursor = [], body_start
    for level, text in headings:
        hit = next((i for i in range(cursor, len(lines)) if text in lines[i]), None)
        if hit is None:
            raise SystemExit(f"Heading not found in PDF: {text}")
        result.append([level, text, hit + 1])
        cursor = hit
    return result, len(document)


for attempt in range(5):
    subprocess.run([sys.executable, str(ROOT / "scripts/build_report.py")], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(OUT), str(OUT / f"{NAME}.docx")], check=True, capture_output=True)
    entries, pages = page_map(OUT / f"{NAME}.pdf")
    previous = json.loads((OUT / "toc.json").read_text()) if (OUT / "toc.json").exists() else None
    (OUT / "toc.json").write_text(json.dumps(entries))
    print(f"pass {attempt + 1}: {pages} pages, {len(entries)} TOC entries")
    if previous == entries:
        break
else:
    raise SystemExit("TOC did not stabilize")
