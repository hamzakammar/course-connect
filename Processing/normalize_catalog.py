#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stream-normalize catalog JSONL into DB-ready envelopes.

Each *input line* is any scraped blob (course page, list page, mixed sections).
Each *output line* is an OutputEnvelope JSON ready for DB insertion.

Usage:
  python normalize_catalog_jsonl.py --in courses.jsonl --out envelopes.jsonl
  python normalize_catalog_jsonl.py --in - --out - --model qwen2.5:14b-instruct

Requires:
  pip install ollama pydantic
"""

from __future__ import annotations
from typing import List, Optional, Literal, Union, Dict, Any, Iterable
from pydantic import BaseModel, Field, constr, ValidationError
from datetime import datetime
import hashlib
import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

import ollama

# -------------------------
# Shared types (match DB)
# -------------------------

TermCode = constr(pattern=r"^[1-4][AB]$")  # Waterloo-style "1A..4B"

class CourseRelation(BaseModel):
    kind: Literal["prereq", "coreq", "exclusion"]
    logic: str
    source_span: Optional[str] = None

class EnrollmentConstraint(BaseModel):
    type: Literal[
        "program_in", "faculty_in", "term_at_least", "term_in",
        "standing", "plan_in", "consent_required"
    ]
    values: Optional[List[str]] = None
    term: Optional[TermCode] = None
    message: Optional[str] = None

class Course(BaseModel):
    code: str
    title: str
    credits: float
    level: int
    subject: str
    description: Optional[str] = None
    attributes: Optional[List[str]] = None
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    source_url: Optional[str] = None
    source_hash: Optional[str] = None
    fetched_at: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0, le=1)

    relations: List[CourseRelation] = Field(default_factory=list)
    enrollment_constraints: List[EnrollmentConstraint] = Field(default_factory=list)

    notes: Optional[List[str]] = None

class CourseSet(BaseModel):
    id_hint: Optional[str] = None
    mode: Literal["explicit", "selector"] = "explicit"
    title: Optional[str] = None
    selector: Optional[Dict[str, Any]] = None
    courses: List[str] = Field(default_factory=list)  # by course code, e.g., "CS 137"

class RequirementNode(BaseModel):
    id_hint: Optional[str] = None
    type: Literal["ALL", "ANY", "N_OF", "CREDITS_AT_LEAST", "NOT"]
    n: Optional[int] = None
    minCredits: Optional[float] = None
    children: Optional[List['RequirementNode']] = None
    courseSet: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None
    constraints: Optional[List[str]] = None
    explanations: Optional[List[str]] = None

RequirementNode.model_rebuild()

class ProgramShell(BaseModel):
    kind: Optional[Literal["degree","major","minor","option","specialization"]] = None
    scope: Optional[Literal["institution_wide","faculty_scoped","program_scoped"]] = None
    title: Optional[str] = None
    catalog_year_label: Optional[str] = None
    owning_faculty_code: Optional[str] = None
    owning_program_codes: Optional[List[str]] = None
    total_credits_required: Optional[float] = None
    policy_ids_hints: Optional[List[str]] = None
    root_requirement: Optional[RequirementNode] = None

class OutputEnvelope(BaseModel):
    courses: List[Course] = Field(default_factory=list)
    course_sets: List[CourseSet] = Field(default_factory=list)
    requirements: List[RequirementNode] = Field(default_factory=list)
    program: Optional[ProgramShell] = None
    provenance: Dict[str, Any] = Field(default_factory=dict)

# -------------------------
# Heuristics (pre/post)
# -------------------------

_CODE_RE = re.compile(r"\b([A-Z]{2,4})\s?-?\s?(\d{2,3}[A-Z]?)\b")

def _norm_code(code: Optional[str], title: Optional[str]) -> Optional[str]:
    if code and code.strip():
        m = _CODE_RE.search(code)
        if m: return f"{m.group(1)} {m.group(2)}"
    if title:
        m = _CODE_RE.search(title)
        if m: return f"{m.group(1)} {m.group(2)}"
    return code

def _subject_level(code: Optional[str]) -> tuple[str,int]:
    if not code: return ("", 0)
    m = _CODE_RE.search(code)
    if not m: return ("", 0)
    subj, num = m.group(1), m.group(2)
    digits = re.findall(r"\d+", num)
    level = 0
    if digits:
        n = int(digits[0])
        level = 400 if n >= 400 else 300 if n >= 300 else 200 if n >= 200 else 100
    return (subj, level)

def _float_units(u: Optional[Union[str,float,int]]) -> Optional[float]:
    if u is None: return None
    s = str(u).strip()
    # normalize "0.50" / "0,50" / "0" / "0.00"
    s = s.replace(",", ".")
    try:
        return float(s)
    except:
        # try to extract first float-like token
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        return float(m.group(1)) if m else None

def _stable_id_hint(parts: List[str]) -> str:
    base = "::".join([p for p in parts if p])
    if not base: base = "unk"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:10]

def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"

# -------------------------
# System & User prompts
# -------------------------

SYSTEM_PROMPT = """You normalize university catalog content to a STRICT JSON envelope for database loading.
Obey the provided JSON Schema exactly.

Guidelines:
- If given a single course blob, fill one Course. Parse code ('CS 343') from title 'CS343 - ...' if needed.
- Convert 'units' or 'credits' to number (0.50 -> 0.5). '0.00' -> 0.0 is fine for seminars/zero-unit.
- Derive subject & level from code (e.g., 3xx -> level 300).
- Map textual prereq/coreq/antireq into CourseRelation using boolean mini-language:
    ALL(...), ANY(...), NOT(...), with operands like course:CS-350 or course:SE-350.
- If prereqs mention plan/faculty/term restrictions (e.g., "Enrolled in H-Software Engineering", "2A or above"),
  put them in enrollment_constraints with type program_in/faculty_in/term_at_least.
- If 'course_lists' exist, produce a CourseSet per list (mode='explicit') with course codes.
- If 'required_by_term' exists, build a RequirementNode tree:
    root: ALL(children per term in ascending order)
    each term: ALL(courseSet="<term-label>") where the CourseSet contains that term's listed courses.
- Keep explanations human readable. If unsure, be conservative and add a note.
Return ONLY JSON.
"""

def _build_user_prompt(scraped: Dict[str, Any]) -> str:
    return (
        "Scraped JSON follows. Transform to the OutputEnvelope JSON object.\n\n"
        + json.dumps(scraped, indent=2, ensure_ascii=False)
    )

# -------------------------
# Ollama structured call
# -------------------------

def _ollama_model(default: str) -> str:
    return os.environ.get("OLLAMA_MODEL", default)

def _call_ollama(scraped: Dict[str, Any], model: str) -> OutputEnvelope:
    schema = OutputEnvelope.model_json_schema()
    resp = ollama.chat(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(scraped)}
        ],
        options={"temperature": 0},
        format=schema,
    )
    content = resp["message"]["content"]
    return OutputEnvelope.model_validate_json(content)

# -------------------------
# Post-normalization
# -------------------------

def _normalize_courses(envelope: OutputEnvelope) -> None:
    for c in envelope.courses:
        c.code = _norm_code(c.code, c.title) or (c.code or "").strip()
        subj, lvl = _subject_level(c.code)
        if not c.subject: c.subject = subj
        if not c.level: c.level = lvl
        c.credits = _float_units(c.credits) or 0.0
        if not c.fetched_at: c.fetched_at = _now_iso()
        # Strip empty relations like ALL()
        c.relations = [r for r in c.relations if r.logic and r.logic.strip() not in ("ALL()", "ANY()")]

def _ensure_course_sets(envelope: OutputEnvelope) -> None:
    for cs in envelope.course_sets:
        if not cs.id_hint:
            cs.id_hint = _stable_id_hint([cs.title or "", ",".join(cs.courses)])

def _normalize_requirements(envelope: OutputEnvelope) -> None:
    def assign_ids(node: RequirementNode, prefix: str):
        if not node.id_hint:
            label = node.courseSet or node.type
            node.id_hint = _stable_id_hint([prefix, label])
        if node.children:
            for i, ch in enumerate(node.children):
                assign_ids(ch, prefix + f":{i}")
    for i, rn in enumerate(envelope.requirements):
        assign_ids(rn, f"req{i}")

def _inject_sets_from_required_by_term(envelope: OutputEnvelope, scraped: Dict[str, Any]) -> None:
    rbt = scraped.get("required_by_term") or {}
    if not rbt: return
    term_order = {"1A":10,"1B":11,"2A":20,"2B":21,"3A":30,"3B":31,"4A":40,"4B":41}
    term_keys = sorted(rbt.keys(), key=lambda t: term_order.get(t, 99))
    children = []
    for term in term_keys:
        items = rbt[term] or []
        codes = []
        for item in items:
            code = _norm_code(item.get("code"), item.get("title"))
            if code: codes.append(code)
        if not codes: continue
        cs_title = f"Required {term}"
        cs = CourseSet(id_hint=_stable_id_hint([cs_title]), title=cs_title, courses=sorted(set(codes)))
        envelope.course_sets.append(cs)
        node = RequirementNode(
            id_hint=_stable_id_hint(["req_term", term]),
            type="ALL",
            courseSet=cs.id_hint,
            explanations=[f"Required courses in term {term}."]
        )
        children.append(node)
    if children:
        root = RequirementNode(
            id_hint=_stable_id_hint(["req_root_required_by_term"]),
            type="ALL",
            children=children,
            explanations=["Complete all required courses by term."]
        )
        if not envelope.requirements:
            envelope.requirements.append(root)

def _inject_sets_from_course_lists(envelope: OutputEnvelope, scraped: Dict[str, Any]) -> None:
    cl = scraped.get("course_lists") or {}
    if not cl: return
    for list_name, payload in cl.items():
        if not isinstance(payload, dict): continue
        courses = []
        for entry in payload.get("courses") or []:
            code = _norm_code(entry.get("code"), entry.get("title"))
            if code: courses.append(code)
        if not courses: continue
        title = payload.get("list_name") or list_name
        cs = CourseSet(
            id_hint=_stable_id_hint(["list", title]),
            title=title,
            mode="explicit",
            courses=sorted(set(courses))
        )
        envelope.course_sets.append(cs)

def _ensure_provenance(envelope: OutputEnvelope, scraped: Dict[str, Any]) -> None:
    url = None
    if isinstance(scraped.get("course"), dict):
        url = scraped["course"].get("source_url")
    url = url or scraped.get("source_url")
    envelope.provenance = {
        "source_url": url,
        "ingested_at": _now_iso(),
        "fingerprint": hashlib.sha1(json.dumps(scraped, sort_keys=True).encode("utf-8")).hexdigest()
    }

def normalize_scraped(scraped: Dict[str, Any], model: str) -> OutputEnvelope:
    # 1) Try structured extraction
    try:
        out = _call_ollama(scraped, model=model)
    except ValidationError:
        out = OutputEnvelope()

    # 2) Safety nets for sections the model might skip
    _inject_sets_from_course_lists(out, scraped)
    _inject_sets_from_required_by_term(out, scraped)

    # 3) Normalize entities
    _normalize_courses(out)
    _ensure_course_sets(out)
    _normalize_requirements(out)
    _ensure_provenance(out, scraped)

    # 4) If no courses emitted but a course-like dict present, create a minimal Course
    if not out.courses:
        # Accept either { "course": {...} } or a flat course dict on the line
        c = scraped.get("course", scraped)
        if isinstance(c, dict) and ("title" in c or "code" in c):
            code = _norm_code(c.get("code"), c.get("title"))
            subj, lvl = _subject_level(code)
            credits = _float_units(c.get("units") or c.get("credits")) or 0.0
            title = c.get("title") or ""
            # If title included code prefix like "CS343 - ...", strip leading code part
            if code and title.startswith(code.replace(" ", "")):
                # e.g., "CS343 - Name" --> "Name"
                title = re.sub(r"^[A-Z]{2,4}\s?-?\s?\d{2,3}[A-Z]?\s*-\s*", "", title)
            elif code and title.startswith(code):
                title = title[len(code):].lstrip(" -–—")
            course = Course(
                code=code or "",
                title=title or c.get("title") or "",
                credits=credits,
                level=lvl, subject=subj,
                description=c.get("description"),
                source_url=c.get("source_url"),
                fetched_at=_now_iso(),
                notes=["Fallback heuristic course parse."]
            )
            prereq = (c.get("prerequisites") or "").strip()
            if prereq:
                # Quick heuristic: if it names plans/faculties/standing, treat as enrollment constraint
                if re.search(r"enrolled in|enrol+ed in|plan|program|standing|term|honours|H-|JH-|BMath|BCS|BBA|SE|CS|CFM|Data Science", prereq, re.I):
                    course.enrollment_constraints.append(EnrollmentConstraint(
                        type="program_in", values=[prereq], message="Plan/faculty/standing restriction parsed verbatim"
                    ))
                else:
                    course.relations.append(CourseRelation(kind="prereq", logic="ALL()", source_span=prereq))
            # Coreqs/antireqs if present
            for k, kind in (("corequisites","coreq"), ("antirequisites","exclusion")):
                txt = (c.get(k) or "").strip()
                if txt:
                    course.relations.append(CourseRelation(kind=kind, logic="ALL()", source_span=txt))
            out.courses.append(course)

    return out

# -------------------------
# Concurrent processing
# -------------------------

def process_single_entry(scraped: Dict[str, Any], model: str) -> Dict[str, Any]:
    """Process a single scraped entry and return the normalized envelope as dict."""
    if scraped.get("_malformed"):
        env = OutputEnvelope(
            provenance={
                "ingested_at": _now_iso(),
                "fingerprint": hashlib.sha1(scraped.get("raw","").encode("utf-8")).hexdigest(),
                "error": f"JSON parse error on line {scraped.get('_line')}: {scraped.get('_error')}"
            }
        )
    else:
        env = normalize_scraped(scraped, model=model)
    
    return json.loads(env.model_dump_json())

# -------------------------
# I/O
# -------------------------

def read_jsonl(fp) -> Iterable[Dict[str, Any]]:
    for i, line in enumerate(fp, 1):
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError as e:
            # Emit a warning envelope with the error captured in provenance
            yield {"_malformed": True, "_line": i, "_error": str(e), "raw": line}

def write_jsonl(fp, objs: Iterable[Dict[str, Any]]) -> None:
    for obj in objs:
        fp.write(json.dumps(obj, ensure_ascii=False) + "\n")
        fp.flush()

# -------------------------
# CLI
# -------------------------

def parse_args():
    ap = argparse.ArgumentParser(description="Normalize catalog JSONL with Ollama structured outputs.")
    ap.add_argument("--in", dest="inp", required=True, help="Input JSONL path or '-' for stdin")
    ap.add_argument("--out", dest="out", required=True, help="Output JSONL path or '-' for stdout")
    ap.add_argument("--model", dest="model", default="qwen2.5:14b-instruct", help="Ollama model (default: qwen2.5:14b-instruct)")
    ap.add_argument("--workers", dest="workers", type=int, default=3, help="Number of concurrent workers (default: 3)")
    return ap.parse_args()

def main():
    args = parse_args()
    model = _ollama_model(args.model)
    max_workers = args.workers

    fin = sys.stdin if args.inp == "-" else open(args.inp, "r", encoding="utf-8")
    fout = sys.stdout if args.out == "-" else open(args.out, "w", encoding="utf-8")

    try:
        # Thread-safe writing with a lock
        write_lock = threading.Lock()
        
        # Read all entries first to enable concurrent processing
        scraped_entries = list(read_jsonl(fin))
        
        # Process entries concurrently in batches
        batch = []
        batch_size = 5
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_entry = {
                executor.submit(process_single_entry, scraped, model): scraped 
                for scraped in scraped_entries
            }
            
            # Process completed tasks as they finish
            for future in as_completed(future_to_entry):
                try:
                    result = future.result()
                    batch.append(result)
                    
                    # Write batch when it reaches the batch size
                    if len(batch) >= batch_size:
                        with write_lock:
                            write_jsonl(fout, batch)
                        batch = []  # Reset batch
                        
                except Exception as exc:
                    print(f"Entry generated an exception: {exc}", file=sys.stderr)
        
        # Write any remaining entries in the final batch
        if batch:
            with write_lock:
                write_jsonl(fout, batch)
            
    finally:
        if fin is not sys.stdin: fin.close()
        if fout is not sys.stdout: fout.close()

if __name__ == "__main__":
    main()
