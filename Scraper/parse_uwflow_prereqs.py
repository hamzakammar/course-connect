#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parse prerequisites from UWFlow data and convert to edges format.
Reads courses.jsonl and generates edges.json compatible with the frontend.
"""

import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

COURSE_RE = re.compile(r"\b([A-Z]{2,6})\s?(\d{2,4}[A-Z]?)\b")

def norm(code: str) -> str:
    """Normalize course code to uppercase without spaces"""
    if not code:
        return ""
    # Try uppercase first, then lowercase
    code_upper = code.upper()
    m = COURSE_RE.search(code_upper)
    if m:
        return (m.group(1) + m.group(2)).upper()
    # If no match, try to extract pattern manually (e.g., "cs341" -> "CS341")
    code_no_spaces = code.upper().replace(' ', '')
    # Pattern: 2-6 letters followed by 2-4 digits optionally followed by a letter
    match = re.match(r'^([A-Z]{2,6})(\d{2,4}[A-Z]?)$', code_no_spaces)
    if match:
        return match.group(1) + match.group(2)
    return ""

def find_codes(text: str) -> List[str]:
    """Extract all course codes from text"""
    return [(a + b).upper() for a, b in COURSE_RE.findall(text or "")]

def parse_prereqs_text(prereqs_text: str, course_id: str) -> List[Dict[str, Any]]:
    """
    Parse free-form prerequisite text into structured edges.
    
    Examples:
    - "CS240 or CS240E" -> ANY logic group
    - "One of CS245, CS245E, SE212" -> ANY logic group  
    - "CS240; MATH239" -> separate groups (both required)
    
    Returns list of edge dictionaries compatible with frontend format.
    """
    if not prereqs_text:
        return []
    
    edges = []
    # Split by semicolons to get major clauses
    clauses = [c.strip() for c in prereqs_text.split(';')]
    
    group_counter = 0
    for clause in clauses:
        clause_lower = clause.lower()
        
        # Skip non-course clauses (program restrictions, etc.)
        codes = find_codes(clause)
        if not codes or course_id.upper() in codes:
            continue
        
        # Check for "One of" pattern
        if re.match(r'(?i)^one\s+of\s+', clause):
            # Extract everything after "One of"
            rest = re.sub(r'(?i)^one\s+of\s+', '', clause)
            codes = find_codes(rest)
            if codes:
                group_counter += 1
                gid = f"{course_id}_prereq_oneof_{group_counter}"
                for code in codes:
                    edges.append({
                        "source": code,
                        "target": course_id.upper(),
                        "type": "PREREQ",
                        "logic": "ANY",
                        "group_id": gid
                    })
        
        # Check for "or" pattern (e.g., "CS240 or CS240E")
        elif ' or ' in clause_lower:
            codes = find_codes(clause)
            if codes:
                group_counter += 1
                gid = f"{course_id}_prereq_or_{group_counter}"
                for code in codes:
                    edges.append({
                        "source": code,
                        "target": course_id.upper(),
                        "type": "PREREQ",
                        "logic": "ANY",
                        "group_id": gid
                    })
        
        # Otherwise, treat as "ALL" (all codes in clause must be taken)
        else:
            codes = find_codes(clause)
            if codes:
                group_counter += 1
                gid = f"{course_id}_prereq_all_{group_counter}"
                for code in codes:
                    edges.append({
                        "source": code,
                        "target": course_id.upper(),
                        "type": "PREREQ",
                        "logic": "ALL",
                        "group_id": gid
                    })
    
    return edges

def parse_antireqs_text(antireqs_text: str, course_id: str) -> List[Dict[str, Any]]:
    """Parse antirequisites (exclusions) from text"""
    if not antireqs_text:
        return []
    
    codes = find_codes(antireqs_text)
    edges = []
    if codes:
        gid = f"{course_id}_antireq_1"
        for code in codes:
            if code != course_id.upper():
                edges.append({
                    "source": code,
                    "target": course_id.upper(),
                    "type": "ANTIREQ",
                    "logic": "ANY",
                    "group_id": gid
                })
    return edges

def parse_coreqs_text(coreqs_text: str, course_id: str) -> List[Dict[str, Any]]:
    """
    Parse corequisites from text.
    Corequisites are bidirectional - if A is a corequisite of B, then B is also a corequisite of A.
    So we create edges in both directions.
    """
    if not coreqs_text:
        return []
    
    codes = find_codes(coreqs_text)
    edges = []
    if codes:
        gid = f"{course_id}_coreq_1"
        for code in codes:
            code_upper = code.upper()
            course_id_upper = course_id.upper()
            if code_upper != course_id_upper:
                # Create edge: code -> course_id (code is corequisite of course_id)
                edges.append({
                    "source": code_upper,
                    "target": course_id_upper,
                    "type": "COREQ",
                    "logic": "ANY",
                    "group_id": gid
                })
                # Create reverse edge: course_id -> code (course_id is corequisite of code)
                edges.append({
                    "source": course_id_upper,
                    "target": code_upper,
                    "type": "COREQ",
                    "logic": "ANY",
                    "group_id": f"{code_upper}_coreq_1"
                })
    return edges

def generate_edges_from_uwflow(uwflow_jsonl_path: Path) -> List[Dict[str, Any]]:
    """Read UWFlow JSONL and generate edges"""
    edges = []
    seen_edges = set()  # Track (source, target, type) to avoid duplicates
    
    with open(uwflow_jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            course_data = json.loads(line)
            course_code = norm(course_data.get("code", ""))
            
            if not course_code:
                continue
            
            # Parse prerequisites
            prereqs_text = course_data.get("prereqs")
            if prereqs_text:
                prereq_edges = parse_prereqs_text(prereqs_text, course_code)
                for edge in prereq_edges:
                    edge_key = (edge["source"], edge["target"], edge["type"])
                    if edge_key not in seen_edges:
                        edges.append(edge)
                        seen_edges.add(edge_key)
            
            # Also use structured prerequisite_courses as fallback
            prerequisite_courses = course_data.get("prerequisite_courses", [])
            if prerequisite_courses and not prereqs_text:
                # If we have structured data but no text, create simple edges
                for prereq in prerequisite_courses:
                    prereq_code = norm(prereq.get("code", ""))
                    if prereq_code and prereq_code != course_code:
                        edge_key = (prereq_code, course_code, "PREREQ")
                        if edge_key not in seen_edges:
                            edges.append({
                                "source": prereq_code,
                                "target": course_code,
                                "type": "PREREQ",
                                "logic": "ANY",
                                "group_id": f"{course_code}_prereq_structured"
                            })
                            seen_edges.add(edge_key)
            
            # Parse antirequisites
            antireqs_text = course_data.get("antireqs")
            if antireqs_text:
                antireq_edges = parse_antireqs_text(antireqs_text, course_code)
                for edge in antireq_edges:
                    edge_key = (edge["source"], edge["target"], edge["type"])
                    if edge_key not in seen_edges:
                        edges.append(edge)
                        seen_edges.add(edge_key)
            
            # Parse corequisites
            # Note: Corequisites are bidirectional, so parse_coreqs_text creates edges in both directions
            coreqs_text = course_data.get("coreqs")
            if coreqs_text:
                coreq_edges = parse_coreqs_text(coreqs_text, course_code)
                for edge in coreq_edges:
                    edge_key = (edge["source"], edge["target"], edge["type"])
                    if edge_key not in seen_edges:
                        edges.append(edge)
                        seen_edges.add(edge_key)
    
    return edges

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Parse prerequisites from UWFlow data")
    parser.add_argument("--input", default="courses.jsonl", help="Input UWFlow JSONL file")
    parser.add_argument("--output", default="edges.json", help="Output edges JSON file")
    args = parser.parse_args()
    
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: {input_path} not found")
        return
    
    print(f"Reading UWFlow data from {input_path}...")
    edges = generate_edges_from_uwflow(input_path)
    
    print(f"Generated {len(edges)} edges")
    
    output_path = Path(args.output)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(edges, f, indent=2)
    
    print(f"Wrote edges to {output_path}")

if __name__ == "__main__":
    main()

