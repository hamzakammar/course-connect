#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Course Connect data pipeline — single entry point.

Pulls from three STRUCTURED sources and joins them by course code:

  1. UW Kuali catalog (Scraper/kuali_catalog.py)
        structured courses: units/credits, level, subject, description, and
        boolean prerequisite / antirequisite / corequisite trees.
  2. UW Open Data API v3 (Scraper/uw_opendata_api.py)
        live seat counts (enrolled / capacity) for the current term.
        Skipped gracefully when UW_OPENDATA_KEY is not set.
  3. UWFlow GraphQL (Scraper/uwflow_api.py)
        ratings (liked/easy/useful) and human-readable prereq/antireq prose.

It then regenerates the artifacts the front-end consumes, matching the exact
shapes already read by app/ (see app/src/context/AppDataContext.tsx):

  data/nodes.json        [{id, code, title, credits, description, subject,
                           level, uwflow_*?, seats_*?}]
  data/edges.json        [{source, target, type, logic, group_id}]
  data/constraints.json  [{target, kind, expr}]   (non-course requirements)
  courses.jsonl          one combined record per course (superset)

Run:  python Processing/build_dataset.py            # everything, all subjects
      python Processing/build_dataset.py --subjects CS MATH SE --limit 50
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Make sibling packages importable whether run from repo root or elsewhere.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "Scraper"))

from kuali_catalog import fetch_all_courses as fetch_kuali_courses, KualiCourseResult  # noqa: E402
from uw_opendata_api import fetch_seats_by_code  # noqa: E402
from uwflow_api import fetch_all_courses as fetch_uwflow_courses  # noqa: E402

# Kuali's rule tree uses these node tags (see kuali_catalog.ReqNode).
ReqNode = Any


# ---------------------------------------------------------------------------
# Boolean tree -> CNF (list of OR-clauses of course codes) + non-course consts
# ---------------------------------------------------------------------------
MAX_CLAUSES = 64  # safety cap: prevents pathological OR-of-AND blow-ups.


def _to_cnf(node: Optional[ReqNode]) -> Tuple[List[List[str]], List[str]]:
    """Return (clauses, consts).

    ``clauses`` is a list of OR-clauses; each clause is a list of course codes
    where satisfying ANY one member satisfies the clause, and ALL clauses must
    be satisfied (conjunctive normal form). ``consts`` collects non-course
    requirement text (program/standing/high-school) for constraints.json.
    """
    if node is None:
        return [], []
    tag = node[0]
    if tag == "COURSE":
        return [[node[1]]], []
    if tag == "CONST":
        return [], [node[1]]
    if tag == "AND":
        clauses: List[List[str]] = []
        consts: List[str] = []
        for child in node[1]:
            c_cl, c_co = _to_cnf(child)
            clauses.extend(c_cl)
            consts.extend(c_co)
        return clauses, consts
    if tag == "OR":
        # CNF(OR of children) = distribute: product across children's clauses.
        child_results = [_to_cnf(child) for child in node[1]]
        consts = [c for _, cos in child_results for c in cos]
        clause_lists = [cl for cl, _ in child_results if cl]
        if not clause_lists:
            return [], consts
        product: List[List[str]] = [[]]
        for cl in clause_lists:
            new_product: List[List[str]] = []
            for existing in product:
                for clause in cl:
                    merged = existing + [c for c in clause if c not in existing]
                    new_product.append(merged)
                    if len(new_product) > MAX_CLAUSES:
                        break
            product = new_product
            if len(product) > MAX_CLAUSES:
                # Degrade gracefully: collapse to a single OR of every code.
                flat: List[str] = []
                for cl2 in clause_lists:
                    for clause in cl2:
                        for c in clause:
                            if c not in flat:
                                flat.append(c)
                return [flat], consts
        return product, consts
    return [], []


def _flat_codes(node: Optional[ReqNode]) -> List[str]:
    """Every course code anywhere in the tree (used for antireq/coreq groups)."""
    if node is None:
        return []
    tag = node[0]
    if tag == "COURSE":
        return [node[1]]
    if tag == "CONST":
        return []
    out: List[str] = []
    for child in node[1]:
        for c in _flat_codes(child):
            if c not in out:
                out.append(c)
    return out


# ---------------------------------------------------------------------------
# Edge / constraint builders
# ---------------------------------------------------------------------------
def build_edges_for_course(kc: KualiCourseResult, known_codes: set) -> List[Dict[str, Any]]:
    """Produce {source,target,type,logic,group_id} edges for one course.

    Prereqs become CNF clauses (each clause -> one ANY group; a single-member
    clause is effectively mandatory). Antireqs/coreqs become one ANY group each,
    matching the existing edge convention.
    """
    code = kc.code
    edges: List[Dict[str, Any]] = []

    def _emit(codes: List[str], kind: str, group_id: str) -> None:
        for src in codes:
            if src == code or src not in known_codes:
                continue
            edges.append({
                "source": src,
                "target": code,
                "type": kind,
                "logic": "ANY",
                "group_id": group_id,
            })

    prereq_clauses, _ = _to_cnf(kc.prereq_tree)
    for i, clause in enumerate(prereq_clauses, 1):
        _emit(clause, "PREREQ", f"{code}_prereq_or_{i}")

    antireq_codes = _flat_codes(kc.antireq_tree)
    if antireq_codes:
        _emit(antireq_codes, "ANTIREQ", f"{code}_antireq_1")

    coreq_codes = _flat_codes(kc.coreq_tree)
    if coreq_codes:
        _emit(coreq_codes, "COREQ", f"{code}_coreq_1")

    return edges


def build_constraints_for_course(kc: KualiCourseResult) -> List[Dict[str, Any]]:
    """Non-course requirement prose -> {target, kind, expr} entries."""
    out: List[Dict[str, Any]] = []
    seen = set()
    for tree, kind_hint in (
        (kc.prereq_tree, "PREREQ"),
        (kc.coreq_tree, "COREQ"),
        (kc.antireq_tree, "ANTIREQ"),
    ):
        _, consts = _to_cnf(tree)
        for expr in consts:
            key = (expr, kind_hint)
            if not expr or key in seen:
                continue
            seen.add(key)
            lower = expr.lower()
            if "enrolled in" in lower or "students only" in lower or "H-" in expr:
                kind = "PROGRAM"
            elif "level" in lower:
                kind = "STANDING"
            else:
                kind = "REQUIREMENT"
            out.append({"target": kc.code, "kind": kind, "expr": expr})
    return out


# ---------------------------------------------------------------------------
# Node builder (join Kuali + UWFlow + seats)
# ---------------------------------------------------------------------------
def build_node(
    kc: KualiCourseResult,
    uwflow: Optional[Dict[str, Any]],
    seats: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    title = f"{kc.code} - {kc.title}" if kc.title else kc.code
    description = kc.description or (uwflow.get("name") if uwflow else None)

    node: Dict[str, Any] = {
        "id": kc.code,
        "code": kc.code,
        "title": title,
        "credits": kc.credits if kc.credits is not None else 0.0,
        "description": description,
        "subject": kc.subject or "",
        "level": kc.level if kc.level is not None else 0,
        "source_url": kc.source_url or None,
    }

    if uwflow:
        for src_key, dst_key in (
            ("rating_liked", "uwflow_rating_liked"),
            ("rating_easy", "uwflow_rating_easy"),
            ("rating_useful", "uwflow_rating_useful"),
            ("rating_filled_count", "uwflow_rating_filled_count"),
            ("rating_comment_count", "uwflow_rating_comment_count"),
        ):
            if uwflow.get(src_key) is not None:
                node[dst_key] = uwflow[src_key]
        if uwflow.get("source_url"):
            node["uwflow_url"] = uwflow["source_url"]
        for src_key, dst_key in (
            ("prereqs", "uwflow_prereqs"),
            ("coreqs", "uwflow_coreqs"),
            ("antireqs", "uwflow_antireqs"),
        ):
            if uwflow.get(src_key):
                node[dst_key] = uwflow[src_key]

    if seats:
        node["seats_enrolled"] = seats.get("enrolled")
        node["seats_capacity"] = seats.get("capacity")
        node["seats_term"] = seats.get("term")

    return node


def build_combined_record(
    kc: KualiCourseResult,
    uwflow: Optional[Dict[str, Any]],
    seats: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """One rich record per course for courses.jsonl (superset of all sources)."""
    return {
        "code": kc.code,
        "title": kc.title,
        "subject": kc.subject,
        "level": kc.level,
        "credits": kc.credits,
        "description": kc.description,
        "crosslistings": kc.crosslistings,
        "source_url": kc.source_url,
        # structured requirement trees (Kuali)
        "prereq_tree": kc.prereq_tree,
        "antireq_tree": kc.antireq_tree,
        "coreq_tree": kc.coreq_tree,
        # ratings + prose (UWFlow)
        "uwflow": uwflow,
        # live seats (Open Data)
        "seats": seats,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def run(
    subjects: Optional[List[str]],
    limit: Optional[int],
    workers: int,
    data_dir: Path,
    jsonl_path: Path,
    term: Optional[str],
) -> None:
    t0 = time.time()

    print("== 1/3 Kuali catalog ==")
    kuali = fetch_kuali_courses(subjects=subjects, limit=limit, workers=workers)
    if not kuali:
        print("No courses fetched from Kuali; aborting.")
        sys.exit(1)
    known_codes = {kc.code for kc in kuali}

    print("== 2/3 UWFlow ratings ==")
    try:
        uwflow = fetch_uwflow_courses()
    except Exception as e:  # noqa: BLE001 - ratings are best-effort
        print(f"UWFlow fetch failed ({e}); continuing without ratings.")
        uwflow = {}

    print("== 3/3 UW Open Data seats ==")
    seats = fetch_seats_by_code(term_code=term)

    print("== joining sources ==")
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    constraints: List[Dict[str, Any]] = []
    combined: List[Dict[str, Any]] = []

    for kc in kuali:
        uf = uwflow.get(kc.code)
        st = seats.get(kc.code)
        nodes.append(build_node(kc, uf, st))
        edges.extend(build_edges_for_course(kc, known_codes))
        constraints.extend(build_constraints_for_course(kc))
        combined.append(build_combined_record(kc, uf, st))

    data_dir.mkdir(parents=True, exist_ok=True)
    _write_json(data_dir / "nodes.json", nodes)
    _write_json(data_dir / "edges.json", edges)
    _write_json(data_dir / "constraints.json", constraints)

    with open(jsonl_path, "w", encoding="utf-8") as f:
        for rec in combined:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    enriched = sum(1 for n in nodes if "uwflow_rating_liked" in n)
    with_seats = sum(1 for n in nodes if n.get("seats_capacity"))
    print(
        f"\nDone in {time.time() - t0:.1f}s\n"
        f"  courses:      {len(nodes)}\n"
        f"  edges:        {len(edges)}\n"
        f"  constraints:  {len(constraints)}\n"
        f"  w/ UWFlow:    {enriched}\n"
        f"  w/ seats:     {with_seats}\n"
        f"  -> {data_dir}/(nodes|edges|constraints).json\n"
        f"  -> {jsonl_path}"
    )


def _write_json(path: Path, data: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(description="Build Course Connect data from Kuali + UW Open Data + UWFlow")
    parser.add_argument("--subjects", nargs="*", default=None,
                        help="Limit to these subject codes (default: all). e.g. CS MATH SE")
    parser.add_argument("--limit", type=int, default=None, help="Max courses (for testing)")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent Kuali detail fetches")
    parser.add_argument("--term", default=None, help="Open Data term code (default: current)")
    parser.add_argument("--data-dir", default=str(REPO_ROOT / "data"), help="Output dir for nodes/edges/constraints")
    parser.add_argument("--jsonl", default=str(REPO_ROOT / "courses.jsonl"), help="Combined per-course JSONL path")
    args = parser.parse_args()

    run(
        subjects=args.subjects,
        limit=args.limit,
        workers=args.workers,
        data_dir=Path(args.data_dir),
        jsonl_path=Path(args.jsonl),
        term=args.term,
    )


if __name__ == "__main__":
    main()
