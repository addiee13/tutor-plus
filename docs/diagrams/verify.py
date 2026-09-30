import hashlib
import html
import json
import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path

from PIL import Image


diagram_directory = Path(__file__).resolve().parent
repository_directory = diagram_directory.parent.parent
measurements = json.loads((diagram_directory / "review-metrics.json").read_text())
assert len(measurements) == 13
for measurement in measurements:
    figure_name = measurement["figure"]
    source_suffix = ".mmd" if figure_name.startswith("context") else ".puml"
    for directory_name, suffix, hash_key in [
        ("source", source_suffix, "source_sha256"),
        ("rendered", ".png", "png_sha256"),
        ("rendered", ".svg", "svg_sha256"),
    ]:
        artifact = diagram_directory / directory_name / f"{figure_name}{suffix}"
        assert hashlib.sha256(artifact.read_bytes()).hexdigest() == measurement[hash_key], artifact
    svg_path = diagram_directory / "rendered" / f"{figure_name}.svg"
    ElementTree.parse(svg_path)
    assert "Syntax Error" not in svg_path.read_text()
    with Image.open(svg_path.with_suffix(".png")) as image:
        image.verify()
    assert measurement["minimum_text_points"] >= 8.0, figure_name

for figure_name in ["context-systems", "context-stakeholders"]:
    source = html.unescape((diagram_directory / "source" / f"{figure_name}.mmd").read_text()).replace("\u00a0", " ")
    assert "<<Tutor Plus System>>" in source
    for provider in ["Stripe Connect", "OpenAI API", "Email Service", "Geocoding Service", "Supabase Platform"]:
        assert provider in source, provider
    assert "-->" not in source
    if figure_name == "context-systems":
        assert "human actor" not in source
    else:
        for actor in ["Student", "Tutor", "Admin"]:
            assert f"{actor}<br/>human actor" in source

activity = (diagram_directory / "source" / "activity-booking-payment.puml").read_text()
assert len(re.findall(r"^stop$", activity, re.MULTILINE)) == 1
assert len(re.findall(r"^start$", activity, re.MULTILINE)) == 1
assert set(re.findall(r"^[ \t]*\|([^|]+)\|$", activity, re.MULTILINE)) == {"Student", "Tutor Plus System", "Stripe Payment", "Tutor"}
for guard in ["available", "unavailable", "approved", "declined"]:
    assert f"[{guard}]" in activity
assert activity.count("repeat while") == 2

expected_relations = {
    "usecase-uc01": [("Register", "Validate", "include"), ("Login", "Resolve", "include"), ("Recover", "Login", "extend"), ("Manage", "Audit", "include")],
    "usecase-uc03": [("Search", "Filter", "include"), ("Search", "Results", "include"), ("Distance", "Search", "extend"), ("Distance", "Geocode", "include")],
    "usecase-uc04": [("Availability", "Rules", "include"), ("Book", "Reserve", "include"), ("Book", "Payment", "include"), ("Replace", "Book", "extend"), ("Change", "Policy", "include")],
    "usecase-uc06": [("Pay", "Create", "include"), ("Retry", "Pay", "extend"), ("Reconcile", "Verify", "include"), ("Refund", "Eligibility", "include")],
}
for figure_name, expected in expected_relations.items():
    source = (diagram_directory / "source" / f"{figure_name}.puml").read_text()
    relations = re.findall(r"^\s*(\w+)\s+\.[\w.]*>\s+(\w+)\s*:\s*<<(include|extend)>>", source, re.MULTILINE)
    assert set(relations) == set(expected), figure_name
    assert 'rectangle "Tutor Plus System"' in source
    assert "<<exclude>>" not in source
    for relation_line in source.splitlines():
        if "<<extend>>" in relation_line:
            assert "[" in relation_line and "]" in relation_line

class_source = (diagram_directory / "source" / "class-uc01.puml").read_text()
assert '*-right- "0..3" RoleGrant' in class_source
assert "<|" not in class_source
sql_source = "\n".join(path.read_text() for path in sorted((repository_directory / "supabase" / "migrations").glob("*.sql")))
table_blocks = dict(re.findall(r"create table\s+(?:public\.)?(\w+)\s*\((.*?)\n\);", sql_source, re.DOTALL | re.IGNORECASE))
checked_columns = 0
for source_path in sorted((diagram_directory / "source").glob("erd-*.puml")):
    for label, body in re.findall(r'entity "([^"]+)" as \w+ \{(.*?)\n\}', source_path.read_text(), re.DOTALL):
        table_name = label.split("\\n")[0]
        if table_name == "auth.users":
            continue
        assert table_name in table_blocks, table_name
        for column in re.findall(r"^\s+\*?\s*([a-z_][a-z0-9_]*)\s*:", body, re.MULTILINE):
            assert re.search(rf"^\s+{re.escape(column)}\s+", table_blocks[table_name], re.MULTILINE), f"{table_name}.{column}"
            checked_columns += 1

print(f"PASS: 13 artifact triples and hashes; XML/PNG integrity; print-size floor >= 8 pt")
print(f"PASS: context providers/boundary; four lanes, two retries, exact guards and one stop")
print(f"PASS: 17 expected directed use-case relations; capability composition without inheritance")
print(f"PASS: {checked_columns} ERD field occurrences match current migration table/column names")
print("Visual and independent instructor reviews remain separate from these structural checks.")
