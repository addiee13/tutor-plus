import hashlib
import json
import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


diagram_directory = Path(__file__).resolve().parent
figure_names = [
    "context-systems", "context-stakeholders", "activity-booking-payment",
    "usecase-uc01", "usecase-uc03", "usecase-uc04", "usecase-uc06",
    "class-uc01", "class-uc04", "erd-uc01", "erd-uc02", "erd-uc04", "erd-uc06",
]
proof_path = diagram_directory / "print-proof.pdf"
document = canvas.Canvas(str(proof_path), pagesize=letter)
document.setTitle("Tutor Plus Sprint 2 diagram print-scale proof")
measurements = []

for page_number, figure_name in enumerate(figure_names, start=1):
    image_path = diagram_directory / "rendered" / f"{figure_name}.png"
    svg_path = image_path.with_suffix(".svg")
    source_suffix = ".mmd" if figure_name.startswith("context") else ".puml"
    source_path = diagram_directory / "source" / f"{figure_name}{source_suffix}"
    svg_root = ElementTree.parse(svg_path).getroot()
    view_box = [float(value) for value in svg_root.attrib["viewBox"].split()]
    font_sizes = [float(element.attrib["font-size"]) for element in svg_root.iter()
                  if "font-size" in element.attrib]
    if font_sizes:
        minimum_font = min(font_sizes)
    else:
        title_font = re.search(r"\.flowchartTitleText\{[^}]*font-size:([0-9.]+)px", svg_path.read_text())
        minimum_font = min(24.0, float(title_font.group(1))) if title_font else 24.0
    wide_page = figure_name.startswith("class")
    page_width, page_height = landscape(letter) if wide_page else letter
    maximum_width = 9.0 if wide_page else 6.5
    maximum_height = 7.0 if wide_page else 7.5 if figure_name.startswith("activity") else 7.3 if figure_name.startswith("context") else 9.0
    scale = min(maximum_width * 72 / view_box[2], maximum_height * 72 / view_box[3])
    figure_width = view_box[2] * scale
    figure_height = view_box[3] * scale
    document.setPageSize((page_width, page_height))
    document.setFont("Helvetica-Bold", 11)
    document.drawString(54, page_height - 35, f"Print-scale proof {page_number}/13: {figure_name}")
    image_left = (page_width - figure_width) / 2
    image_bottom = (page_height - figure_height) / 2
    document.drawImage(ImageReader(str(image_path)), image_left, image_bottom,
                       width=figure_width, height=figure_height)
    document.setFont("Helvetica", 9)
    document.drawString(54, 28, f"Editable source: docs/diagrams/source/{source_path.name}")
    document.drawString(54, 15, "Diagram review proof only; not application, provider or client acceptance evidence.")
    document.showPage()
    with Image.open(image_path) as image:
        image_dimensions = list(image.size)
    measurements.append({
        "figure": figure_name,
        "page": page_number,
        "orientation": "landscape" if wide_page else "portrait",
        "print_width_inches": round(figure_width / 72, 3),
        "print_height_inches": round(figure_height / 72, 3),
        "minimum_text_points": round(minimum_font * scale, 2),
        "png_dimensions": image_dimensions,
        "source_sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "png_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
        "svg_sha256": hashlib.sha256(svg_path.read_bytes()).hexdigest(),
    })

document.save()
metrics_path = diagram_directory / "review-metrics.json"
metrics_path.write_text(json.dumps(measurements, indent=2) + "\n")
print(f"Created {proof_path}: {len(measurements)} complete figures")
for measurement in measurements:
    print(f"{measurement['figure']}: {measurement['print_width_inches']} x "
          f"{measurement['print_height_inches']} inches; minimum text "
          f"{measurement['minimum_text_points']} points")
