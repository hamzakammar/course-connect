#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, re, sys
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional

COURSE_RE = re.compile(r"\b([A-Z]{2,6})\s?(\d{2,4}[A-Z]?)\b")

def norm(code:str)->str:
    m = COURSE_RE.search(code or "")
    return (m.group(1)+m.group(2)).upper() if m else ""

def find_codes(text:str)->List[str]:
    return [ (a+b).upper() for a,b in COURSE_RE.findall(text or "") ]

@dataclass
class Node:
    id:str; 
    title:Optional[str]=None; 
    credits:Optional[float]=None; 
    level:Optional[int]=None; 
    subject:Optional[str]=None; 
    source_url:Optional[str]=None

@dataclass
class Edge:
    from_id:str; 
    to_id:str; 
    kind:str; 
    group_id:Optional[str]=None; 
    logic:Optional[str]=None; 
    k:Optional[int]=None; 
    concurrent_ok:Optional[bool]=None; 
    source_span:Optional[str]=None

@dataclass
class Constraint:
    target:str; 
    kind:str; 
    expr:str

def read_any(path:str)->List[Dict[str,Any]]:
    with open(path,'r',encoding='utf-8') as f:
        try:
            obj = json.load(f)
        except json.JSONDecodeError:
            f.seek(0)
            obj = [json.loads(l) for l in f if l.strip()]
    # Normalize to a flat list of course dicts
    courses: List[Dict[str,Any]] = []
    if isinstance(obj, dict) and "courses" in obj:
        courses = obj["courses"]
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, dict) and "courses" in item:
                courses.extend(item["courses"] or [])
            elif isinstance(item, dict) and "code" in item:
                courses.append(item)
    else:
        courses = []
    return courses

def split_any_clauses(text:str)->List[str]:
    if not text: return []
    parts = re.split(r"(?i)must have completed at least 1 of the following:", text)
    clauses = []
    for p in parts[1:]:
        stop = re.split(r"(?i)(must have completed|complete all of the following|enrolled in|students must be|not completed|no credit|$)", p)[0]
        clauses.append(stop)
    return clauses

def parse_course(course:Dict[str,Any]):
    cid = norm(course.get("code",""))
    node = Node(id=cid, title=course.get("title"), credits=course.get("credits"), level=course.get("level"), subject=course.get("subject"), source_url=course.get("source_url"))
    edges:List[Edge] = []
    constraints:List[Constraint] = []

    for rel in course.get("relations", []) or []:
        span = rel.get("source_span", "") or ""
        kind = (rel.get("kind") or "").lower()
        text_lower = span.lower()

        # --- ANTIREQ ---
        if "exclusion" in kind or "not completed" in text_lower or "no credit" in text_lower:
            codes = [c for c in find_codes(span) if c != cid]
            if codes:
                gid = f"{cid}_antireq_1"
                for c in codes:
                    edges.append(Edge(
                        from_id=c,
                        to_id=cid,
                        kind="ANTIREQ",
                        group_id=gid,
                        logic="ANY",
                        source_span=span
                    ))
            continue  # don't also add as coreq

        # --- COREQ ---
        if "coreq" in kind or (
            "concurrently enrolled" in text_lower and "not completed" not in text_lower
        ):
            codes = [c for c in find_codes(span) if c != cid]
            if codes:
                gid = f"{cid}_coreq_1"
                for c in codes:
                    edges.append(Edge(
                        from_id=c,
                        to_id=cid,
                        kind="COREQ",
                        group_id=gid,
                        logic="ANY",
                        concurrent_ok=True,
                        source_span=span
                    ))

    for ec in course.get("enrollment_constraints",[]) or []:
        values = ec.get("values") or []
        for v in values:
            txt = str(v)
            if re.search(r"(?i)\bH-Software Engineering|Honours|Computer Science|Data Science|BBA & BCS", txt):
                constraints.append(Constraint(target=cid, kind="PROGRAM", expr=txt))

            m = re.search(r"(?i)level\s*(1A|1B|2A|2B|3A|3B|4A|4B)", txt)
            if m:
                constraints.append(Constraint(target=cid, kind="STANDING", expr=m.group(0)))

            for clause in split_any_clauses(txt):
                codes = [c for c in find_codes(clause) if c != cid]
                if codes:
                    gid = f"{cid}_pr_any_{abs(hash(clause))%10000}"
                    for c in codes:
                        edges.append(Edge(from_id=c, to_id=cid, kind="PREREQ", group_id=gid, logic="ANY", source_span=clause))

            mg = re.search(r"(?i)(?:minimum|at least)\s*(\d{2})\s*%.*?(?:each|all)?\s*(?:of the following|in)", txt)
            if mg:
                grade_val = int(mg.group(1))
                codes = [c for c in find_codes(txt) if c != cid]
                if codes:
                    gid = f"{cid}_pr_all_{abs(hash(txt))%10000}"
                    for c in codes:
                            edges.append(Edge(
                                from_id=c,
                                to_id=cid,
                                kind="PREREQ",
                                group_id=gid,
                                logic="ALL",
                                source_span=txt,
                                k=None,
                                concurrent_ok=False,
                            ).__dict__ | {"min_grade": grade_val})

    return node, edges, constraints

def compile_file(input_path:str, out_nodes:str, out_edges:str, out_constraints:str):
    courses = read_any(input_path)
    nodes=[]; edges=[]; constraints=[]
    seen=set()
    for c in courses:
        n,e,k = parse_course(c)
        if n.id and n.id not in seen:
            nodes.append(n); seen.add(n.id)
        edges += [asdict(x) for x in e]; constraints += [asdict(x) for x in k]

    existing = {n.id for n in nodes}
    for e in edges:
        if e["from_id"] and e["from_id"] not in existing:
            nodes.append(Node(id=e["from_id"])); existing.add(e["from_id"])

    from dataclasses import asdict as _asdict
    with open(out_nodes,"w",encoding="utf-8") as f: json.dump([_asdict(n) for n in nodes], f, indent=2)
    with open(out_edges,"w",encoding="utf-8") as f: json.dump(edges, f, indent=2)
    with open(out_constraints,"w",encoding="utf-8") as f: json.dump(constraints, f, indent=2)

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("--nodes", default="nodes.json")
    p.add_argument("--edges", default="edges.json")
    p.add_argument("--constraints", default="constraints.json")
    args = p.parse_args()
    compile_file(args.input, args.nodes, args.edges, args.constraints)
