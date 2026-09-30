from __future__ import annotations

import json
import re
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION_START, WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/doc"
OUT.mkdir(parents=True, exist_ok=True)
TOC_FILE = OUT / "toc.json"
FIGURES = ROOT / "docs/diagrams/rendered"
DOC = Document()
FIGURE_NUMBER = 0
TABLE_NUMBER = 0
HEADINGS = []
TOC_PAGES = {}


def inline(paragraph, text):
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    for piece in re.split(r"(\*\*.*?\*\*|`[^`]+`)", text):
        if not piece:
            continue
        run = paragraph.add_run(piece[2:-2] if piece.startswith("**") else piece.strip("`"))
        run.bold = piece.startswith("**")
        if piece.startswith("`"):
            run.font.name = "Courier New"
            run.font.size = Pt(9.5)


def body(text, style=None):
    paragraph = DOC.add_paragraph(style=style)
    paragraph.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    inline(paragraph, text)
    return paragraph


def heading(text, level=1, new_page=False):
    paragraph = DOC.add_heading(text, level=level)
    paragraph.paragraph_format.page_break_before = new_page
    if level <= 2 and text != "TABLE OF CONTENTS":
        HEADINGS.append([level, text])
    return paragraph


def orientation(landscape):
    section = DOC.add_section(WD_SECTION_START.NEW_PAGE)
    section.orientation = WD_ORIENT.LANDSCAPE if landscape else WD_ORIENT.PORTRAIT
    section.page_width = Inches(11 if landscape else 8.5)
    section.page_height = Inches(8.5 if landscape else 11)
    section.header.is_linked_to_previous = True
    section.footer.is_linked_to_previous = True
    section.top_margin = Inches(0.35 if landscape else 0.85)
    section.bottom_margin = Inches(0.35 if landscape else 0.8)
    section.header_distance = Inches(0.12 if landscape else 0.4)
    section.footer_distance = Inches(0.12 if landscape else 0.4)


def caption(text):
    paragraph = DOC.add_paragraph(style="Caption")
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    inline(paragraph, text)
    return paragraph


def field(paragraph, instruction, value="1"):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    run._r.append(begin)
    command = OxmlElement("w:instrText")
    command.set(qn("xml:space"), "preserve")
    command.text = instruction
    run._r.append(command)
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    run._r.append(separate)
    run.add_text(value)
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(end)


def configure():
    section = DOC.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.85)
    section.bottom_margin = Inches(0.8)
    section.left_margin = Inches(0.9)
    section.right_margin = Inches(0.9)
    section.header_distance = Inches(0.4)
    section.footer_distance = Inches(0.4)
    for style_name in ["Normal", "Body Text", "List Bullet", "List Number"]:
        style = DOC.styles[style_name]
        style.font.name = "Times New Roman"
        style.font.size = Pt(11)
        style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        style.paragraph_format.line_spacing = 1.12
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.widow_control = True
    for level, size in [(1, 16), (2, 13), (3, 11.5), (4, 11)]:
        style = DOC.styles[f"Heading {level}"]
        style.font.name = "Arial"
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.font.bold = True
        style.paragraph_format.space_before = Pt(12)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.keep_with_next = True
    DOC.styles["Title"].font.name = "Times New Roman"
    DOC.styles["Title"].font.size = Pt(24)
    DOC.styles["Title"].font.bold = True
    DOC.styles["Title"].font.color.rgb = RGBColor(0, 0, 0)
    DOC.styles["Caption"].font.name = "Times New Roman"
    DOC.styles["Caption"].font.size = Pt(10)
    DOC.styles["Caption"].font.color.rgb = RGBColor(0, 0, 0)
    DOC.styles["Caption"].paragraph_format.space_after = Pt(8)
    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.LEFT
    header.paragraph_format.tab_stops.add_tab_stop(Inches(4.2))
    header.add_run("Group 11\tSoftware Engineering Project").font.size = Pt(10)
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    field(footer, " PAGE ")
    settings = DOC.settings.element
    update = OxmlElement("w:updateFields")
    update.set(qn("w:val"), "true")
    settings.append(update)
    DOC.core_properties.title = "Tutor Plus Smart Platform for Academic Progress Sprint 2"
    DOC.core_properties.author = "Adam Dalwai; Shadmaan Akhand; Edu M. Okpok; Kien Duong; Nikhil Rodrigo"
    DOC.core_properties.subject = "Group 11 Software Engineering Fall 2026"


def table(headers, rows, title=None, widths=None):
    global TABLE_NUMBER
    if title:
        TABLE_NUMBER += 1
        paragraph = caption(f"Table {TABLE_NUMBER}. {title}")
        paragraph.paragraph_format.keep_with_next = True
    result = DOC.add_table(rows=1, cols=len(headers))
    result.alignment = WD_TABLE_ALIGNMENT.CENTER
    result.autofit = False
    result.style = "Table Grid"
    available_width = DOC.sections[-1].page_width.inches - 1.8
    if not widths:
        widths = [available_width / len(headers)] * len(headers)
        if len(headers) == 2:
            widths = [available_width * 0.22, available_width * 0.78]
        elif len(headers) == 3:
            widths = [available_width * 0.19, available_width * 0.57, available_width * 0.24]
    repeat = OxmlElement("w:tblHeader")
    result.rows[0]._tr.get_or_add_trPr().append(repeat)
    if widths:
        for column, width in zip(result.columns, widths):
            column.width = Inches(width)
    for cell, value in zip(result.rows[0].cells, headers):
        inline(cell.paragraphs[0], value)
        for run in cell.paragraphs[0].runs:
            run.bold = True
        shading = OxmlElement("w:shd")
        shading.set(qn("w:fill"), "EDEDED")
        cell._tc.get_or_add_tcPr().append(shading)
    for values in rows:
        for cell, value in zip(result.add_row().cells, values):
            inline(cell.paragraphs[0], str(value).replace("<br>", "\n"))
    for row in result.rows:
        row_properties = row._tr.get_or_add_trPr()
        cannot_split = OxmlElement("w:cantSplit")
        row_properties.append(cannot_split)
        for cell, width in zip(row.cells, widths):
            cell.width = Inches(width)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            margins = OxmlElement("w:tcMar")
            for edge in ["top", "left", "bottom", "right"]:
                margin = OxmlElement(f"w:{edge}")
                margin.set(qn("w:w"), "90")
                margin.set(qn("w:type"), "dxa")
                margins.append(margin)
            cell._tc.get_or_add_tcPr().append(margins)
            for paragraph in cell.paragraphs:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                paragraph.paragraph_format.space_after = Pt(2)
                paragraph.paragraph_format.line_spacing = 1.05
                for run in paragraph.runs:
                    run.font.size = Pt(9 if len(headers) >= 5 else 10)
    DOC.add_paragraph().paragraph_format.space_after = Pt(2)
    return result


def figure(filename, description, maximum_height=7.3):
    global FIGURE_NUMBER
    path = FIGURES / filename
    if not path.exists():
        raise FileNotFoundError(f"Required rendered figure missing: {path}")
    image = Image.open(path)
    available_width = DOC.sections[-1].page_width.inches - 1.8
    width = min(available_width, maximum_height * image.width / image.height)
    paragraph = DOC.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.keep_with_next = True
    paragraph.add_run().add_picture(str(path), width=Inches(width))
    FIGURE_NUMBER += 1
    caption(f"Figure {FIGURE_NUMBER}. {description}")


def code_figure(text, description):
    global FIGURE_NUMBER
    lines = text.splitlines()
    font_path = "/System/Library/Fonts/Menlo.ttc"
    font = ImageFont.truetype(font_path, 21)
    measure = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    width = int(max(measure.textlength(line, font=font) for line in lines)) + 48
    height = len(lines) * 31 + 36
    image = Image.new("RGB", (width, height), "white")
    drawing = ImageDraw.Draw(image)
    for index, line in enumerate(lines):
        drawing.text((24, 18 + index * 31), line, font=font, fill="black")
    path = OUT / f"code-{FIGURE_NUMBER + 1}.png"
    image.save(path)
    paragraph = DOC.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.keep_with_next = True
    paragraph.add_run().add_picture(str(path), width=Inches(min(6.6, width / 145)))
    FIGURE_NUMBER += 1
    caption(f"Figure {FIGURE_NUMBER}. {description}")


def markdown(path, skip_title=True, subsection_pages=False, base_level=2, only_section=None):
    lines = (ROOT / path).read_text().splitlines()
    if only_section:
        start = next(index for index, line in enumerate(lines) if line.startswith(only_section))
        depth = len(lines[start]) - len(lines[start].lstrip("#"))
        end = next((index for index in range(start + 1, len(lines)) if lines[index].startswith("#" * depth + " ")), len(lines))
        lines = lines[start + 1:end]
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line or line == "---":
            index += 1
            continue
        if line.startswith("#"):
            depth = len(line) - len(line.lstrip("#"))
            if depth == 1 and skip_title:
                index += 1
                continue
            title = line[depth:].strip().replace("**", "").replace("`", "")
            new_page = subsection_pages and bool(re.match(r"(UC|REQ)-\d\d", title))
            heading(title, min(4, base_level + max(0, depth - 2)), new_page)
            index += 1
            continue
        if line.startswith("|") and index + 1 < len(lines) and re.match(r"\|[\s:|\-]+$", lines[index + 1].strip()):
            headers = [cell.strip() for cell in line.strip("|").split("|")]
            rows = []
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append([cell.strip() for cell in lines[index].strip().strip("|").split("|")])
                index += 1
            table(headers, rows)
            continue
        if line.startswith("```"):
            content = []
            index += 1
            while index < len(lines) and not lines[index].startswith("```"):
                content.append(lines[index])
                index += 1
            if content:
                code_figure("\n".join(content), "Editable source excerpt; full source accompanies this report")
            index += 1
            continue
        if line.startswith("- "):
            body(line[2:], "List Bullet")
            index += 1
            continue
        numbered = re.match(r"^\d+[.)]\s+(.*)", line)
        if numbered:
            step = body(f"{line.split()[0]} {numbered.group(1)}")
            step.paragraph_format.left_indent = Inches(0.3)
            step.paragraph_format.first_line_indent = Inches(-0.3)
            index += 1
            continue
        paragraph_lines = [line]
        index += 1
        while index < len(lines) and lines[index].strip() and not re.match(r"^(#|\||-|\d+[.)] |```)", lines[index].strip()):
            paragraph_lines.append(lines[index].strip())
            index += 1
        body(" ".join(paragraph_lines))


def baseline_biographies():
    original = Document(ROOT / "docs/Dalwai_Group11_Sprint1.docx")
    paragraphs = original.paragraphs
    start = next(index for index, paragraph in enumerate(paragraphs) if paragraph.text.strip() == "Software Engineers’ information")
    end = next(index for index in range(start + 1, len(paragraphs)) if paragraphs[index].text.strip() == "Planning and Scheduling")
    for paragraph in paragraphs[start + 1:end]:
        if paragraph.text.strip():
            body(paragraph.text)


def cover():
    DOC.add_paragraph().paragraph_format.space_after = Pt(66)
    paragraph = DOC.add_paragraph("Tutor Plus Smart Platform for Academic Progress", style="Title")
    paragraph.paragraph_format.space_after = Pt(14)
    body("Software Engineering Project | Sprint 2 | Group 11")
    DOC.add_paragraph().paragraph_format.space_after = Pt(46)
    for text in [
        "Names: Adam Dalwai, Shadmaan Akhand, Edu M. Okpok, Kien Duong, Nikhil Rodrigo",
        "Semester: Fall 2026",
        "Group Number: 11 | Client Group: 8",
        "Sprint 2 Coordinator: Adam Dalwai (rotated from Shadmaan Akhand)",
        "Guide: Dr. Tushara Sadasivuni",
        "Prepared: September 30, 2026",
        "Submission deadline: Monday, October 5, 2026, before class",
    ]:
        body(text)
    body("This report continues the Sprint 1 specification with ten detailed use cases and paired requirements, corrected system models, four database groups, and implementation evidence. Proposed behavior, demonstrated local results, and pending external confirmation are identified separately.")
    heading("TABLE OF CONTENTS", 1, True)
    toc_block()


def toc_block():
    """TOC field whose cached result lists the headings and pages found by the previous pass."""
    entries = json.loads(TOC_FILE.read_text()) if TOC_FILE.exists() else []
    paragraphs = []
    for level, text, page in entries or [[1, "", ""]]:
        paragraph = DOC.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
        paragraph.paragraph_format.left_indent = Inches(0.3 * (level - 1))
        paragraph.paragraph_format.space_after = Pt(2)
        paragraph.paragraph_format.tab_stops.add_tab_stop(Inches(6.7), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        run = paragraph.add_run(f"{text}\t{page}" if text else "")
        run.bold = level == 1
        paragraphs.append(paragraph)
    def fld(paragraph, kind, instruction=None, first=False):
        run = OxmlElement("w:r")
        mark = OxmlElement("w:fldChar")
        mark.set(qn("w:fldCharType"), kind)
        run.append(mark)
        if instruction:
            code = OxmlElement("w:instrText")
            code.set(qn("xml:space"), "preserve")
            code.text = instruction
            run.append(code)
        if first:
            paragraph._p.insert(paragraph._p.index(paragraph._p.find(qn("w:r"))) if paragraph._p.find(qn("w:r")) is not None else len(paragraph._p), run)
        else:
            paragraph._p.append(run)
    head = paragraphs[0]
    anchor = head._p.find(qn("w:r"))
    for kind, instruction in [("begin", None), (None, ' TOC \\o "1-2" \\h \\z \\u '), ("separate", None)]:
        run = OxmlElement("w:r")
        if kind:
            mark = OxmlElement("w:fldChar")
            mark.set(qn("w:fldCharType"), kind)
            run.append(mark)
        else:
            code = OxmlElement("w:instrText")
            code.set(qn("xml:space"), "preserve")
            code.text = instruction
            run.append(code)
        if anchor is not None:
            anchor.addprevious(run)
        else:
            head._p.append(run)
    fld(paragraphs[-1], "end")


def evidence():
    path = ROOT / "docs/evidence/results.json"
    if not path.exists():
        raise FileNotFoundError("Actual validation results.json must exist before report assembly")
    return json.loads(path.read_text())


def source_excerpt(path, start=0, count=20):
    lines = (ROOT / path).read_text().splitlines()
    return "\n".join(lines[start:start + count])


def assemble():
    configure()
    cover()
    heading("1.0 INTRODUCTION", 1, True)
    body("Tutor Plus connects adult students with tutors and coordinates evidence-based learning before and after each session. Sprint 2 refines the Sprint 1 product baseline and begins implementation without treating all fifteen semester features as completed. The nine primary headings retain the Sprint 1 table-of-contents structure.")
    heading("1.1 Software Engineers Information", 2)
    table(["Member", "Email", "Sprint 2 responsibility"], [
        ["Adam Dalwai", "adalwai1@student.gsu.edu", "Coordinator; integration and submission"],
        ["Shadmaan Akhand", "sakhand2@student.gsu.edu", "Identity and application review"],
        ["Edu M. Okpok", "eokpok1@student.gsu.edu", "Requirements and report review"],
        ["Kien Duong", "kduong10@student.gsu.edu", "Database and scheduling review"],
        ["Nikhil Rodrigo", "nrodrigo2@student.gsu.edu", "Modeling and validation review"],
    ], "Team roster and proposed Sprint 2 work allocation", [1.3, 2.25, 3.1])
    body("The coordinator designation comes from the current project directive. Work allocation and hour estimates are planning assignments, not claims that a member has performed or approved the work.")
    baseline_biographies()
    orientation(True)
    heading("1.2 Planning and Scheduling", 2)
    markdown("docs/planning/SPRINT2_EXECUTION.md", only_section="## Planning and scheduling", base_level=3)
    orientation(False)
    heading("1.3 Teamwork Basics", 2)
    body("The coordinator integrates section drafts and maintains the Sprint 2 checklist. Each member reviews their assigned artifacts against the SDD and lectures; cross-review is required before submission. Discord and iMessage remain team communication tools, not in-app direct chat. The repository provides shared source history; the project board tracks evidence-backed To Do, In Progress, and Done states. No team or client approval is inferred from generated documents.")
    heading("1.4 Problem Statement", 2)
    markdown("docs/sprint2/PROBLEM_STATEMENT.md", base_level=3)
    heading("1.5 System Requirements", 2)
    body("The baseline serves adults aged 18 or older and supports Student, Tutor, and Administrator capabilities. Student and Tutor capabilities may coexist on one account. Managed identity is separate from private profiles and database-authorized roles. Native video, direct chat, peer skill swaps, and guardian workflows remain outside SDD version 1.1. The ten detailed specifications appear in Section 2; five retained semester features are a separate next-sprint backlog.")
    heading("1.5.1 Context Diagram", 2, True)
    body("The primary context model follows the system-modeling lecture: one Tutor Plus boundary with external systems and no internal modules represented as external peers. The companion view fulfills the directive's human-actor and labeled-flow requirements. Supabase remains an external managed persistence and identity boundary. Stripe, AI, geocoding, and outbound email are planned adapters unless execution evidence explicitly demonstrates them.")
    figure("context-systems.png", "CTX-01. Lecture-conformant system context", 5.8)
    heading("Stakeholder Companion View", 3, True)
    figure("context-stakeholders.png", "CTX-02. Student, Tutor, Administrator, and external-system interactions", 6.7)
    body("Human actors are not stereotyped as systems. Edge labels describe exchanged domain information, not internal calls. Full editable Mermaid sources accompany both figures.")
    heading("1.5.2 Activity Diagram", 2, True)
    figure("activity-booking-payment.png", "ACT-01. Guarded booking and payment workflow with four swimlanes", 7.5)
    body("The diagram uses one initial state and one final stop node, explicit guards, and retries that revalidate the reservation. Payment approval is authoritative only after verified provider processing; a redirect alone is not success. This is a product behavior model, not evidence that a live Stripe integration or booking UI has been demonstrated.")
    heading("2.0 REQUIREMENTS", 1, True)
    body("Use-case identifiers follow the existing Sprint 2 draft, while names are clarified by the current directive. The SDD feature order differs: diagnostics, assignments, and learning features retain traceability without renumbering the ten Sprint 2 records. The lecture template adds Inputs, Outputs, and Rationale to the directive's minimum fields.")
    heading("2.1 Use Cases", 2)
    markdown("docs/sprint2/USE_CASES.md", subsection_pages=True, base_level=3)
    heading("2.2 Requirements", 2, True)
    markdown("docs/sprint2/REQUIREMENTS.md", subsection_pages=True, base_level=3)
    heading("2.3 Use Case Diagrams", 2, True)
    body("The four diagrams cover UC-01, UC-03, UC-04, and UC-06. Dashed include relationships point from the base use case to mandatory reused behavior; extend relationships point from optional conditional behavior to the base. Neither relation grants authorization or implies completion of planned integrations.")
    for filename, title in [
        ("usecase-uc01.png", "UCD-01. User Management"),
        ("usecase-uc03.png", "UCD-02. Tutor Search and Approximate Distance"),
        ("usecase-uc04.png", "UCD-03. Availability and Booking"),
        ("usecase-uc06.png", "UCD-04. Payments, Platform Fees, and Refunds"),
    ]:
        heading(title, 3, True)
        figure(filename, title, 8.0)
    heading("3.0 DATABASE TABLES", 1, True)
    body("Target DBMS: PostgreSQL 15, managed through Supabase, with PostGIS and btree_gist. Local execution results identify the actual engine version. Four database groups implement UC-01, UC-02, UC-04, and UC-06; a group can contain many supporting tables. Managed auth.users is not re-created in application DDL. The canonical versioned migrations are mirrored by sql/sprint2_tables.sql for standalone review and replay.")
    heading("3.1 Database Dictionary and Relationships", 2)
    markdown("docs/architecture/SPRINT2_DATABASE.md", base_level=3)
    for filename, title in [
        ("erd-uc01.png", "ERD-01. UC-01 identity and roles"),
        ("erd-uc02.png", "ERD-02. UC-02 profiles and public tutor projection"),
        ("erd-uc04.png", "ERD-03. UC-04 availability and bookings"),
        ("erd-uc06.png", "ERD-04. UC-06 payments and audit"),
    ]:
        heading(title, 3, True)
        figure(filename, title, 7.1)
    heading("3.2 SQL and Database Communication", 2, True)
    body("A form calls a server action, the domain service verifies the actor and validates inputs, and a user-scoped Supabase client reaches PostgreSQL. RLS and least-privilege grants protect direct API access as well as application routes. Role assignment, booking reservation, and other transactional invariants use narrowly scoped database functions. Provider financial processing is isolated from ordinary user writes.")
    markdown("docs/sprint2/IMPLEMENTATION.md", only_section="## Database execution", base_level=3)
    orientation(True)
    heading("4.0 CLASS DIAGRAM", 1)
    heading("4.1 UC-01 User Management Classes", 2)
    figure("class-uc01.png", "CLASS-01. Identity, session, profiles, and role capabilities", 6.65)
    heading("4.2 UC-04 Booking Classes", 2, True)
    figure("class-uc04.png", "CLASS-02. Transactional booking design", 7.0)
    orientation(False)
    body("RoleGrant is composed with the account, not a mutually exclusive Student/Tutor subclass. Verified identity, current profile status, and current role rows are separate authority checks. The provider session row anchors the fixed 24-hour application lifetime; refresh never creates a new anchor.")
    body("UC-04 classes describe the scheduling service boundary and database transaction, not a completed booking screen. The second demonstrated frontend flow is UC-02 profile read/edit/save. Profile responsibilities are shown in CLASS-01 and the implementation mapping below. Booking and payment UI behavior remains planned.")
    heading("4.3 Frontend and Logic Implementation", 2, True)
    markdown("docs/sprint2/IMPLEMENTATION.md", only_section="## Implemented flows", base_level=3)
    markdown("docs/sprint2/IMPLEMENTATION.md", only_section="## Source excerpts", base_level=3)
    heading("5.0 BEHAVIORAL MODELING", 1, True)
    body("ACT-01 in Section 1.5.2 models the future booking-to-learning path. Concurrency protection belongs in PostgreSQL, not a UI availability check. A reserved slot is not a paid confirmation. A declined payment returns to a controlled retry or release branch; expiry and cancellation release eligible holds without claiming a refund or transfer succeeded. Assignment, assessment, review, and notification transitions are specified in UC-05 and UC-07 through UC-10 and remain later UI work.")
    heading("6.0 IMPLEMENTATION", 1, True)
    heading("6.1 Environment and Configuration", 2)
    markdown("docs/sprint2/IMPLEMENTATION.md", only_section="## Environment and build", base_level=3)
    heading("6.2 Standalone Build and Run", 2)
    body("No IDE is required. scripts/build.sh owns the fresh install, type, lint, unit-test, and production-build contract. The caller configures an isolated intended Supabase project, applies versioned migrations, and starts the production server. No privileged key is embedded in a browser bundle or committed environment file.")
    code_figure("./scripts/build.sh\nnpm run start -- --hostname 127.0.0.1 --port 3000\nnpm run test:integration\nnpm run test:e2e", "Terminal-only build, run, and verification entry points")
    heading("6.3 Fresh Execution Evidence", 2)
    result = evidence()
    table(["Validation", "Observed result", "Evidence"], result["checks"], "Executed validation, distinct from formal next-sprint test cases")
    heading("7.0 TESTING", 1, True)
    heading("7.1 Test Cases", 2)
    body("Formal requirement test-case specifications remain TBD for the next sprint, exactly as instructed by the lecture template. Test cases: TBD appears in each requirement. Executed unit, smoke, policy, integration, concurrency, and browser checks are separately recorded in Section 7.2; writing a plan or leaving a case TBD is not a passing result.")
    heading("7.2 Actual Validation Record", 2)
    markdown("docs/evidence/VALIDATION.md", base_level=3)
    heading("8.0 ARCHITECTURAL MODELING", 1, True)
    heading("8.1 Architectural Views", 2)
    body("Tutor Plus uses one Next.js/React/TypeScript modular monolith with feature-owned domain services. Route composition and form rendering do not own authorization. Supabase Auth owns identity, public.profiles owns private application profile data, and user_roles owns capabilities. Normal operations retain the user's JWT so RLS executes as that user. Administrative bootstrap is a deliberate isolated server-only operation; subsequent role changes are audited database-authorized requests.")
    heading("8.2 Architectural Model", 2)
    body("The logical view is presentation -> server action -> domain service -> user-scoped Supabase adapter -> PostgreSQL constraints and RLS. Stripe, geocoding, AI, and transactional email use separate adapters. Private learning records and provider identifiers never enter the public tutor snapshot. UTC instants, IANA time zones, and integer money units avoid ambiguous scheduling and floating-point financial state. A local mailbox proves local verification delivery only, not delivery to a real external inbox.")
    heading("9.0 GITHUB", 1, True)
    markdown("docs/sprint2/GITHUB_AND_SUBMISSION.md", base_level=3)
    heading("Application Screenshot Evidence", 2, True)
    manifest = ROOT / "docs/evidence/screenshots.json"
    if manifest.exists():
        for shot in json.loads(manifest.read_text()):
            path = ROOT / shot["path"]
            if not path.exists():
                raise FileNotFoundError(path)
            image = Image.open(path)
            paragraph = DOC.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            paragraph.paragraph_format.keep_with_next = True
            paragraph.add_run().add_picture(str(path), width=Inches(min(6.65, 6.2 * image.width / image.height)))
            global FIGURE_NUMBER
            FIGURE_NUMBER += 1
            caption(f"Figure {FIGURE_NUMBER}. {shot['description']}")
    heading("REFERENCES", 1, True)
    for text in [
        "R1. Sprint 2 mission directive supplied September 30, 2026. The point allocation and reported Sprint 1 grade come from the user; no independent grade report or separate complete assignment sheet was available in this workspace.",
        "R2. Dalwai_Group11_Sprint1.docx, September 18, 2026. Cover, roster, biographies, paragraph typography, main heading structure, and existing problem statement. Original file preserved unchanged.",
        "R3. TutorPlus_SDD_v1_1.pdf. Sections 5-6 product features and requirements; sections 11-13 data model, authorization, scheduling; quality and acceptance sections. Product baseline for adults and structured coordination.",
        "R4. Sprint2_UseCases_Requirements_DB.pdf. Historical draft and identifier ordering; its implementation/completion claims are not independent execution evidence.",
        "R5. 4_Requirement_ENgineering_SWE-5.pdf, physical pages 60 and 64-68. UML include/extend and strict use-case/requirement templates. Requirement Name and Rationale retained; test cases deferred.",
        "R6. 5_System_Modeling_SWE.pdf, physical pages 15-17, 23, and 38 onward. External context, actors and system boundaries, class modeling. ContextDiagram.pdf, physical pages 2-3; ActivityDiagram.pdf, physical pages 3-6.",
        "R7. DatabaseFundamentals.pdf, physical pages 20-23 and 36. Primary/foreign keys, normalization, and scenario-based schema design. 1_Intro_SWE.pdf and 2_Processes_SWE .pdf support engineering quality and incremental workflow.",
        "R8. Official Next.js App Router installation and authentication documentation; Supabase SSR, user-management, session, RLS, and local-development documentation; PostgreSQL 15 range/exclusion documentation. Consulted September 30, 2026. Exact installed package versions are recorded in package-lock.json.",
        "R9. Official GitHub CLI repository/project documentation and GitHub Projects API documentation, consulted September 30, 2026. Execution evidence records actual repository and board state, not predicted URLs.",
    ]:
        body(text)
    heading("Appendix A Requirement Traceability", 1, True)
    markdown("docs/planning/TRACEABILITY.md", base_level=2)
    heading("Appendix B Deliverable and Submission Gates", 1, True)
    body("This checklist distinguishes generated artifacts from the human and external evidence still required. An internal evaluator's review estimate is not an instructor-issued grade. Every member submits a correctly named PDF; the coordinator prints a copy before class on October 5, 2026. Actual submission and printing must be confirmed after they occur.")
    markdown("docs/sprint2/REPORT_CHECKLIST.md", base_level=2)
    destination = OUT / "Adam_Dalwai_Group11_Sprint2.docx"
    DOC.save(destination)
    (OUT / "headings.json").write_text(json.dumps(HEADINGS))
    print(json.dumps({"docx": str(destination), "figures": FIGURE_NUMBER, "tables": len(DOC.tables), "paragraphs": len(DOC.paragraphs)}, indent=2))


if __name__ == "__main__":
    assemble()
