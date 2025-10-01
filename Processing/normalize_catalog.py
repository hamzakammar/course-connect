#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Normalize arbitrary scraped catalog blobs (course page, course lists, "required_by_term", mixed)
into a single JSON envelope aligned with your DB schema.

Requires:
  pip install ollama pydantic

Usage:
  python normalize_catalog.py < my_scrape.json > out.json
  # or pass a specific model (see recs below):
  python normalize_catalog.py qwen2.5:14b-instruct < my_scrape.json > out.json
"""

from __future__ import annotations
from typing import List, Optional, Literal, Union, Dict, Any
from pydantic import BaseModel, Field, constr, ValidationError
from datetime import datetime
import hashlib
import json
import os
import re
import sys

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
    # courses table (no DB ids here—let your DB assign)
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

    # joinables
    relations: List[CourseRelation] = Field(default_factory=list)
    enrollment_constraints: List[EnrollmentConstraint] = Field(default_factory=list)

    notes: Optional[List[str]] = None

class CourseSet(BaseModel):
    # mirrors course_sets + course_set_members (explicit mode)
    id_hint: Optional[str] = None  # for stable naming; your DB will still assign UUID
    mode: Literal["explicit", "selector"] = "explicit"
    title: Optional[str] = None    # human label e.g. list name or "Required 1A"
    selector: Optional[Dict[str, Any]] = None
    courses: List[str] = Field(default_factory=list)  # by course code, e.g., "CS 137"

class RequirementNode(BaseModel):
    id_hint: Optional[str] = None
    type: Literal["ALL", "ANY", "N_OF", "CREDITS_AT_LEAST", "NOT"]
    n: Optional[int] = None
    minCredits: Optional[float] = None
    children: Optional[List['RequirementNode']] = None
    courseSet: Optional[str] = None           # refer by CourseSet id_hint/title
    filters: Optional[Dict[str, Any]] = None
    constraints: Optional[List[str]] = None
    explanations: Optional[List[str]] = None

RequirementNode.update_forward_refs()

class ProgramShell(BaseModel):
    # Optional scaffold if a page clearly represents a specific plan
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
    try: return float(u)
    except: 
        try: return float(str(u).replace(",", "."))
        except: return None

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
You MUST obey the provided JSON Schema exactly.

Guidelines:
- If given a single course blob, fill one Course. Parse code ('CS 137') from title 'CS137 - ...' if needed.
- Convert 'units' or 'credits' text to number (0.50 -> 0.5).
- Derive subject & level from code (e.g., 1xx -> 100).
- Map textual prereq/coreq/antireq into CourseRelation using boolean mini-language:
    ALL(...), ANY(...), NOT(...), with atoms like course:CS-136
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
# Ollama call (structured)
# -------------------------

def _model_for_cli() -> str:
    return sys.argv[1] if len(sys.argv) > 1 else os.environ.get("OLLAMA_MODEL", "qwen2.5:14b-instruct")

def _call_ollama(scraped: Dict[str, Any], model: str) -> OutputEnvelope:
    schema = OutputEnvelope.model_json_schema()
    resp = ollama.chat(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(scraped)}
        ],
        options={"temperature": 0},
        format=schema,  # force structured output
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
        # Scrub empty relations like ALL() if present
        c.relations = [r for r in c.relations if r.logic and r.logic.strip() not in ("ALL()", "ANY()")]

def _ensure_course_sets(envelope: OutputEnvelope) -> None:
    # Assign stable id_hints if missing
    for cs in envelope.course_sets:
        if not cs.id_hint:
            cs.id_hint = _stable_id_hint([cs.title or "", ",".join(cs.courses)])

def _normalize_requirements(envelope: OutputEnvelope) -> None:
    # Assign id_hints to requirement nodes (preorder traversal)
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
    # If the model didn’t produce course sets for required_by_term, do it here.
    rbt = scraped.get("required_by_term") or {}
    if not rbt: return
    # Build an ALL root with one child per term
    term_keys = sorted(rbt.keys(), key=lambda t: ("1234".find(t[0]), t))
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
        # Only add if there isn't already a requirement in envelope
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
    # pick any available URL
    url = None
    if isinstance(scraped.get("course"), dict):
        url = scraped["course"].get("source_url")
    if not url:
        # try any nested hrefs
        for section in ("course_lists","required_by_term"):
            s = scraped.get(section) or {}
            if isinstance(s, dict):
                for v in s.values():
                    if isinstance(v, dict):
                        for it in v.get("courses") or []:
                            if it.get("href"):
                                url = url or it["href"]
    envelope.provenance = {
        "source_url": url,
        "ingested_at": _now_iso(),
        "fingerprint": hashlib.sha1(json.dumps(scraped, sort_keys=True).encode("utf-8")).hexdigest()
    }

def normalize(scraped: Dict[str, Any], model: str) -> OutputEnvelope:
    # 1) try structured extraction
    try:
        out = _call_ollama(scraped, model=model)
    except ValidationError as ve:
        # If model returned invalid JSON, fall back to a minimal envelope we fill heuristically
        out = OutputEnvelope()

    # 2) safety nets (add sets from raw sections if model omitted them)
    _inject_sets_from_course_lists(out, scraped)
    _inject_sets_from_required_by_term(out, scraped)

    # 3) normalize entities
    _normalize_courses(out)
    _ensure_course_sets(out)
    _normalize_requirements(out)
    _ensure_provenance(out, scraped)

    # 4) last-mile: if a single course blob was provided but model didn’t emit it
    if not out.courses and isinstance(scraped.get("course"), dict):
        c = scraped["course"]
        code = _norm_code(c.get("code"), c.get("title"))
        subj, lvl = _subject_level(code)
        course = Course(
            code=code or "",
            title=(c.get("title") or "").replace(code or "", "").strip(" -") or (c.get("title") or ""),
            credits=_float_units(c.get("units") or c.get("credits")) or 0.0,
            level=lvl, subject=subj,
            description=c.get("description"),
            source_url=c.get("source_url"),
            fetched_at=_now_iso(),
            notes=["Fallback heuristic course parse."]
        )
        # Enrollment constraint heuristic: if 'prerequisites' mentions enrolled/plan
        prereq = (c.get("prerequisites") or "").strip()
        if prereq:
            if re.search(r"enrolled in|enrol+ed in|plan|program|standing|term", prereq, re.I):
                course.enrollment_constraints.append(EnrollmentConstraint(
                    type="program_in", values=[prereq], message="Plan/faculty/standing restriction parsed verbatim"
                ))
            else:
                course.relations.append(CourseRelation(kind="prereq", logic="ALL()", source_span=prereq))
        out.courses.append(course)

    return out

# -------------------------
# CLI
# -------------------------

def main():
    scraped = json.load(sys.stdin)
    model = _model_for_cli()
    envelope = normalize(scraped, model)
    print(envelope.model_dump_json(indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
