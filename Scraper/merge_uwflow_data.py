#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Merge UWFlow data (ratings, descriptions, source_url) into nodes.json.
Reads courses.jsonl and nodes.json, then outputs enriched nodes.json.
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, Optional

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

def load_uwflow_data(uwflow_jsonl_path: Path) -> Dict[str, Dict[str, Any]]:
    """Load UWFlow data into a dictionary keyed by normalized course code"""
    uwflow_data = {}
    
    with open(uwflow_jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            course_data = json.loads(line)
            course_code = norm(course_data.get("code", ""))
            if course_code:
                uwflow_data[course_code] = course_data
    
    return uwflow_data

def merge_uwflow_into_nodes(nodes: list, uwflow_data: Dict[str, Dict[str, Any]]) -> list:
    """Merge UWFlow data into nodes, enriching with ratings, descriptions, etc."""
    enriched_nodes = []
    
    for node in nodes:
        node_code = norm(node.get("code") or node.get("id", ""))
        enriched_node = node.copy()
        
        if node_code in uwflow_data:
            uwflow = uwflow_data[node_code]
            
            # Merge description if node doesn't have one or UWFlow has better one
            if not enriched_node.get("description") and uwflow.get("name"):
                # Use UWFlow name as description if we don't have one
                enriched_node["description"] = uwflow.get("name")
            elif uwflow.get("description"):
                enriched_node["description"] = uwflow.get("description")
            
            # Add UWFlow ratings
            if uwflow.get("rating_liked") is not None:
                enriched_node["uwflow_rating_liked"] = uwflow.get("rating_liked")
            if uwflow.get("rating_easy") is not None:
                enriched_node["uwflow_rating_easy"] = uwflow.get("rating_easy")
            if uwflow.get("rating_useful") is not None:
                enriched_node["uwflow_rating_useful"] = uwflow.get("rating_useful")
            if uwflow.get("rating_filled_count") is not None:
                enriched_node["uwflow_rating_filled_count"] = uwflow.get("rating_filled_count")
            if uwflow.get("rating_comment_count") is not None:
                enriched_node["uwflow_rating_comment_count"] = uwflow.get("rating_comment_count")
            
            # Add UWFlow source URL
            if uwflow.get("source_url"):
                enriched_node["uwflow_url"] = uwflow.get("source_url")
            
            # Add raw prerequisite text for reference
            if uwflow.get("prereqs"):
                enriched_node["uwflow_prereqs"] = uwflow.get("prereqs")
            if uwflow.get("coreqs"):
                enriched_node["uwflow_coreqs"] = uwflow.get("coreqs")
            if uwflow.get("antireqs"):
                enriched_node["uwflow_antireqs"] = uwflow.get("antireqs")
        
        enriched_nodes.append(enriched_node)
    
    return enriched_nodes

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Merge UWFlow data into nodes.json")
    parser.add_argument("--nodes", default="app/public/data/nodes.json", help="Input nodes JSON file")
    parser.add_argument("--uwflow", default="courses.jsonl", help="Input UWFlow JSONL file")
    parser.add_argument("--output", default="app/public/data/nodes.json", help="Output nodes JSON file")
    args = parser.parse_args()
    
    nodes_path = Path(args.nodes)
    uwflow_path = Path(args.uwflow)
    output_path = Path(args.output)
    
    if not nodes_path.exists():
        print(f"Error: {nodes_path} not found")
        return
    
    if not uwflow_path.exists():
        print(f"Error: {uwflow_path} not found")
        return
    
    print(f"Loading nodes from {nodes_path}...")
    with open(nodes_path, 'r', encoding='utf-8') as f:
        nodes = json.load(f)
    
    print(f"Loading UWFlow data from {uwflow_path}...")
    uwflow_data = load_uwflow_data(uwflow_path)
    
    print(f"Found UWFlow data for {len(uwflow_data)} courses")
    print(f"Merging data into {len(nodes)} nodes...")
    
    enriched_nodes = merge_uwflow_into_nodes(nodes, uwflow_data)
    
    # Count how many nodes were enriched
    enriched_count = sum(1 for node in enriched_nodes if "uwflow_rating_liked" in node)
    print(f"Enriched {enriched_count} nodes with UWFlow data")
    
    print(f"Writing enriched nodes to {output_path}...")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(enriched_nodes, f, indent=2, ensure_ascii=False)
    
    print("Done!")

if __name__ == "__main__":
    main()

