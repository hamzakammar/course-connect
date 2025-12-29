#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extract program plan data from scraper JSONL output and generate program_plan.json
"""

import json
import sys
from pathlib import Path
from typing import Dict, Any, Optional

def extract_program_plan_from_jsonl(jsonl_path: Path) -> Optional[Dict[str, Any]]:
    """Extract program data from JSONL file (first line should be program data)"""
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            data = json.loads(line)
            # Check if this is program data (has required_by_term or elective_requirements_by_term)
            if 'required_by_term' in data or 'elective_requirements_by_term' in data:
                return data
            # Or check if it has program_url
            if 'program_url' in data:
                return data
    return None

def update_program_plan_json(program_plan_path: Path, program_data: Dict[str, Any]):
    """Update program_plan.json with new program data"""
    # Read existing program_plan.json
    with open(program_plan_path, 'r', encoding='utf-8') as f:
        program_plan = json.load(f)
    
    # Update the program section
    if 'program' in program_plan:
        program = program_plan['program']
        
        # Update elective_requirements_by_term if present in new data
        if 'elective_requirements_by_term' in program_data:
            program['elective_requirements_by_term'] = program_data['elective_requirements_by_term']
            print(f"Updated elective_requirements_by_term: {program_data['elective_requirements_by_term']}")
        
        # Update required_by_term if present
        if 'required_by_term' in program_data:
            program['required_by_term'] = program_data['required_by_term']
            print(f"Updated required_by_term for {len(program_data['required_by_term'])} terms")
        
        # Update other fields if present
        for key in ['title', 'description', 'course_lists']:
            if key in program_data:
                program[key] = program_data[key]
                print(f"Updated {key}")
    
    # Write back
    with open(program_plan_path, 'w', encoding='utf-8') as f:
        json.dump(program_plan, f, indent=2, ensure_ascii=False)
    
    print(f"Updated {program_plan_path}")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Extract program plan from scraper JSONL")
    parser.add_argument("--input", default="se_program.jsonl", help="Input JSONL file from scraper")
    parser.add_argument("--output", default="app/public/data/program_plan.json", help="Output program_plan.json path")
    args = parser.parse_args()
    
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: {input_path} not found")
        print("Run the scraper first: python3 Scraper/uw_se_scraper.py --out se_program.jsonl")
        return 1
    
    print(f"Reading program data from {input_path}...")
    program_data = extract_program_plan_from_jsonl(input_path)
    
    if not program_data:
        print("Error: No program data found in JSONL file")
        return 1
    
    output_path = Path(args.output)
    update_program_plan_json(output_path, program_data)
    
    return 0

if __name__ == "__main__":
    sys.exit(main())

