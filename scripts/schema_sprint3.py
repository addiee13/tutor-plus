"""Parse supabase/migrations/*.sql into a table dictionary and generate the Sprint 3 ERD (PlantUML).

Usage: python3 scripts/schema_sprint3.py   -> output/doc/schema_sprint3.json
                                              docs/diagrams/source/erd-sprint3.puml
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "supabase/migrations").glob("*.sql"))
KEYWORDS = {"primary", "references", "not", "null", "default", "check", "unique", "generated", "constraint", "collate"}


def split_top(body: str) -> list[str]:
    parts, depth, current, quoted = [], 0, [], False
    for ch in body:
        if ch == "'":
            quoted = not quoted
        if quoted:
            current.append(ch)
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    if "".join(current).strip():
        parts.append("".join(current).strip())
    return parts


def table_blocks(sql: str):
    for match in re.finditer(r"create table ([\w.]+) \(", sql, re.I):
        start = match.end()
        depth, i, quoted = 1, start, False
        while depth:
            if sql[i] == "'":
                quoted = not quoted
            elif not quoted:
                depth += {"(": 1, ")": -1}.get(sql[i], 0)
            i += 1
        yield match.group(1), sql[start:i - 1], match


def short_type(tokens: list[str]) -> str:
    text = " ".join(tokens).replace("timestamp with time zone", "timestamptz")
    return text.replace("character(", "char(").replace("extensions.", "")


def parse() -> dict:
    tables = {}
    for path in MIGRATIONS:
        sql = re.sub(r"--[^\n]*", "", path.read_text())
        for name, body, _ in table_blocks(sql):
            schema, _, bare = name.rpartition(".")
            schema = schema or "public"
            columns, pk, fks, uniques, checks = [], [], [], [], []
            for item in split_top(body):
                flat = " ".join(item.split())
                low = flat.lower()
                if low.startswith("primary key"):
                    pk = [c.strip() for c in re.search(r"\(([^)]*)\)", flat).group(1).split(",")]
                elif low.startswith("foreign key"):
                    m = re.match(r"foreign key \(([^)]*)\) references ([\w.]+)\(([^)]*)\)", flat, re.I)
                    fks.append({"columns": [c.strip() for c in m.group(1).split(",")],
                                "table": m.group(2).split(".")[-1], "ref": [c.strip() for c in m.group(3).split(",")]})
                elif low.startswith("unique"):
                    uniques.append([c.strip() for c in re.search(r"\(([^)]*)\)", flat).group(1).split(",")])
                elif low.startswith(("check", "exclude", "constraint")):
                    checks.append(flat)
                else:
                    tokens = flat.split(" ")
                    col = tokens[0]
                    type_tokens = []
                    for tok in tokens[1:]:
                        if tok.lower() in KEYWORDS:
                            break
                        type_tokens.append(tok)
                    rest = flat[len(col) + 1 + len(" ".join(type_tokens)):].strip()
                    info = {"name": col, "type": short_type(type_tokens), "constraints": rest}
                    if re.search(r"\bprimary key\b", rest, re.I):
                        pk = [col]
                    ref = re.search(r"references ([\w.]+)\((\w+)\)", rest, re.I)
                    if ref:
                        fks.append({"columns": [col], "table": ref.group(1).split(".")[-1], "ref": [ref.group(2)]})
                    if re.search(r"\bunique\b", rest, re.I):
                        uniques.append([col])
                    columns.append(info)
            tables[bare] = {"schema": schema, "migration": path.name, "columns": columns, "pk": pk, "fks": fks,
                            "uniques": uniques, "checks": checks}
    return tables


GROUPS_A = [
    ("UC-01 User Management", ["profiles", "user_roles", "audit_logs"]),
    ("UC-02 Manage Student and Tutor Profiles", ["subjects", "tutor_profiles", "tutor_subjects", "public_tutor_snapshots"]),
    ("UC-04 Availability and Booking", ["availability_rules", "availability_exceptions", "bookings",
                                        "booking_private_details", "booking_events"]),
    ("UC-06 Payments and Refunds", ["payments", "payment_events", "refunds", "payout_refs"]),
]
GROUPS_B = [
    ("UC-09 Session Planner and Recap", ["session_plans", "session_recaps", "session_reflections"]),
    ("UC-07 Reviews and Ratings", ["reviews", "tutor_rating_summaries"]),
    ("UC-05 Diagnostic Assessment", ["assessments", "assessment_questions", "assessment_answer_keys",
                                     "assessment_attempts"]),
    ("UC-08 Practice Tasks and Assignments", ["assignments", "assignment_submissions", "assignment_feedback"]),
]
STUBS_B = ["profiles", "tutor_profiles", "subjects", "bookings"]


def rest_count(t, fk_cols):
    return len([c for c in t["columns"] if c["name"] not in t["pk"] and c["name"] not in fk_cols])


def erd(tables: dict, groups, title, stubs=(), hidden=(), direction="top to bottom direction", full_columns=False, font=19, stub_title="Referenced Sprint 2 tables (keys only)") -> str:
    lines = ["@startuml", "!include theme-sprint3.iuml", "skinparam dpi 200", f"skinparam defaultFontSize {font}",
             direction, "skinparam nodesep 30", "skinparam ranksep 60",
             "hide circle", "hide methods", "hide stereotypes",
             f"skinparam PackageFontSize {font}", "skinparam PackageFontStyle bold", f"skinparam TitleFontSize {font + 3}", f"title {title}"]
    shown, stubbed = set(), set()

    def entity(name, full):
        t = tables[name]
        fk_cols = {c for fk in t["fks"] for c in fk["columns"]}
        out = [f"  entity {name} {{"]
        for c in t["columns"]:
            if c["name"] in t["pk"]:
                out.append(f"    * **{c['name']}** : {c['type']} <<PK>>" + (" <<FK>>" if c["name"] in fk_cols else ""))
        if full:
            out.append("    --")
            for c in t["columns"]:
                if c["name"] in t["pk"] or (c["name"] not in fk_cols and not full_columns):
                    continue
                out.append(f"    {c['name']} : {c['type']}" + (" <<FK>>" if c["name"] in fk_cols else ""))
            rest = 0 if full_columns else rest_count(t, fk_cols)
            if rest:
                out.append(f"    //+ {rest} more attribute{'s' if rest > 1 else ''}//")
        out.append("  }")
        return out

    if stubs:
        lines.append(f'package "{stub_title}" {{')
        for name in stubs:
            lines += entity(name, False)
            stubbed.add(name)
        lines.append("}")
    for group_title, names in groups:
        lines.append(f'package "{group_title}" {{')
        for name in names:
            lines += entity(name, True)
            shown.add(name)
        lines.append("}")
    if not stubs:
        lines.append('entity "auth.users" as auth_users {\n  * **id** : uuid <<PK>>\n}')
    present = shown | stubbed
    seen = set()
    for name in sorted(present):
        t = tables[name]
        unique_cols = [set(u) for u in t["uniques"]] + [set(t["pk"])]
        for fk in t["fks"]:
            target = "auth_users" if fk["table"] == "users" else fk["table"]
            if target == "auth_users" and stubs:
                continue
            if target != "auth_users" and target not in present:
                continue
            if name == target or (name in stubbed and target in stubbed and stubs):
                continue
            if name == "bookings" and target == "tutor_subjects":
                continue
            if name == "assessments" and target == "tutor_subjects":
                continue
            key = (name, target)
            if key in seen:
                continue
            seen.add(key)
            one_to_one = set(fk["columns"]) in unique_cols
            nullable = all("not null" not in c["constraints"].lower() and c["name"] not in t["pk"]
                           for c in t["columns"] if c["name"] in fk["columns"])
            left = "|o" if nullable else "||"
            right = "o|" if one_to_one else "o{"
            lines.append(f"{target} {left}--{right} {name}")
    lines += [f"{a} -[hidden]down- {b}" for a, b in hidden]
    lines.append("@enduml")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    data = parse()
    out = ROOT / "output/doc"
    out.mkdir(parents=True, exist_ok=True)
    (out / "schema_sprint3.json").write_text(json.dumps(data, indent=1))
    src = ROOT / "docs/diagrams/source"
    for group_title, names in GROUPS_A + GROUPS_B:
        code = group_title.split(" ")[0].lower().replace("-", "")
        refs = []
        for n in names:
            for fk in data[n]["fks"]:
                if fk["table"] not in names and fk["table"] != "users" and fk["table"] not in refs:
                    refs.append(fk["table"])
        refs = [r for r in refs if not (r == "tutor_subjects")]
        (src / f"erd-{code}-sprint3.puml").write_text(
            erd(data, [(group_title, names)], f"ERD: {group_title}", refs, full_columns=True, font=15,
                stub_title="Referenced tables (keys only)"))
    (src / "erd-sprint3-part1.puml").write_text(erd(data, GROUPS_A, "ERD Part 1: Sprint 2 table groups (UC-01, UC-02, UC-04, UC-06)",
        hidden=[("audit_logs", "payments")]))
    (src / "erd-sprint3-part2.puml").write_text(erd(data, GROUPS_B, "ERD Part 2: Sprint 3 table groups (UC-05, UC-07, UC-08, UC-09)", STUBS_B,
        hidden=[("session_plans", "assessments"), ("tutor_rating_summaries", "assignments")]))
    print(len(data), "tables:", ", ".join(sorted(data)))
