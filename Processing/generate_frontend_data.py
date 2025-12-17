import json
import argparse
import sys
from typing import Dict, Any, List, Optional
import re # Added missing import for regex
import os # Added missing import for os

# Assuming OutputEnvelope, Course, CourseRelation, RequirementNode, CourseSet are defined in normalize_catalog.py
# For this script, we'll redefine simplified versions or just work with dicts
# to avoid complex imports if not strictly necessary, or import them directly if available.

# --- Simplified Data Structures for Frontend ---
# These largely mirror the OutputEnvelope structure but are flattened/optimized for graph/display

class FrontendCourseNode:
    def __init__(self, course_code: str, title: str, credits: float, description: str, subject: str, level: int):
        self.id = course_code # Using course code as unique ID for simplicity
        self.code = course_code
        self.title = title
        self.credits = credits
        self.description = description
        self.subject = subject
        self.level = level

    def to_dict(self):
        return {
            "id": self.id,
            "code": self.code,
            "title": self.title,
            "credits": self.credits,
            "description": self.description,
            "subject": self.subject,
            "level": self.level,
        }

class FrontendCourseEdge:
    def __init__(self, source_course_id: str, target_course_id: str, relation_type: str, logic: str = ""):
        self.source = source_course_id
        self.target = target_course_id
        self.type = relation_type # e.g., "prereq", "coreq", "exclusion"
        self.logic = logic # Boolean logic for complex relations

    def to_dict(self):
        return {
            "source": self.source,
            "target": self.target,
            "type": self.type,
            "logic": self.logic,
        }

class ProgramRequirement:
    def __init__(self, id: str, type: str, content: Any, explanations: List[str] = None):
        self.id = id
        self.type = type # e.g., "ALL", "ANY", "N_OF", "CREDITS_AT_LEAST", "courseSet"
        self.content = content # Can be a list of child requirements, a courseSet ID, or a credit count
        self.explanations = explanations if explanations is not None else []

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type,
            "content": self.content,
            "explanations": self.explanations,
        }

def generate_frontend_data(input_jsonl_path: str, output_dir: str):
    nodes: Dict[str, FrontendCourseNode] = {}
    edges: List[FrontendCourseEdge] = []
    all_program_requirements: Dict[str, ProgramRequirement] = {}
    all_course_sets: Dict[str, Any] = {}
    
    program_plan_output_program: Dict[str, Any] = {
        "title": "",
        "required_by_term": {},
        "course_lists": {}
    }
    
    with open(input_jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            envelope_data = json.loads(line)
            
            # Accumulate Courses
            for course_data in envelope_data.get("courses", []):
                code = course_data.get("code")
                if code:
                    new_credits = course_data.get("credits", 0.0)
                    title_lower = (course_data.get("title", "") or "").lower()
                    is_seminar = "seminar" in title_lower
                    
                    # Seminars should be 0.0 credits
                    if is_seminar:
                        new_credits = 0.0
                    
                    # Handle duplicates: prefer entries with non-zero credits, or update if current entry has 0 credits
                    if code not in nodes:
                        nodes[code] = FrontendCourseNode(
                            course_code=code,
                            title=course_data.get("title", ""),
                            credits=new_credits,
                            description=course_data.get("description", ""),
                            subject=course_data.get("subject", ""),
                            level=course_data.get("level", 0)
                        )
                    else:
                        # Update if current entry has 0 credits and new entry has non-zero credits
                        # Or if new entry has a different non-zero value (prefer the more common/specific one)
                        current_credits = nodes[code].credits
                        title_lower = (course_data.get("title", "") or "").lower()
                        is_seminar = "seminar" in title_lower
                        
                        # Seminars should be 0.0 credits
                        if is_seminar:
                            nodes[code].credits = 0.0
                        elif current_credits == 0.0 and new_credits > 0:
                            nodes[code].credits = new_credits
                        elif current_credits > 0 and new_credits > 0 and new_credits != current_credits:
                            # If we have conflicting non-zero values, prefer the one that's not 0.5 (more specific)
                            # This handles cases like ECE192 where one entry says 0.5 and others say 0.25
                            if new_credits != 0.5 and current_credits == 0.5:
                                nodes[code].credits = new_credits
                
                # Accumulate Course Relations (edges)
                # Edges point FROM the related course TO the course that has the relation
                # e.g., if CS241 has CS137 as a prerequisite, edge is: source=CS137, target=CS241
                for relation in course_data.get("relations", []):
                    kind = relation.get("kind")
                    logic = relation.get("logic")
                    
                    related_courses = re.findall(r"course:([A-Z]{2,4}[-\s]?\d{2,3}[A-Z]?)", logic)
                    for related_code in related_courses:
                        normalized_related = related_code.replace("-", " ")
                        edges.append(FrontendCourseEdge(
                            source_course_id=normalized_related,  # The prerequisite/coreq/antireq course
                            target_course_id=code,  # The course that has this requirement
                            relation_type=kind,
                            logic=logic
                        ))

            # Capture ProgramShell if present and assign directly
            # Only update if we haven't already captured program data, or if this envelope has better data
            if envelope_data.get("program"):
                new_program_data = envelope_data.get("program")
                print(f"DEBUG: Found program data in envelope: {new_program_data}")
                # Only update if we don't have program data yet (empty title), or if the new data has non-empty required_by_term
                has_existing_data = program_plan_output_program.get("title")
                new_has_terms = bool(new_program_data.get("required_by_term"))
                if not has_existing_data or new_has_terms:
                    program_plan_output_program = new_program_data
                    print(f"DEBUG: program_plan_output_program after assignment: {program_plan_output_program}")
                
                # Process required_by_term from program_plan_output_program
                for term_name, courses_in_term in program_plan_output_program.get("required_by_term", {}).items():
                    term_course_set_id_hint = f"req_term_{term_name.lower().replace(' ', '')}"
                    if term_course_set_id_hint not in all_course_sets: # Deduplicate course sets
                        all_course_sets[term_course_set_id_hint] = {
                            "id_hint": term_course_set_id_hint,
                            "mode": "explicit",
                            "title": f"Required {term_name}",
                            "courses": [c["code"] for c in courses_in_term]
                        }
                    req_id = f"term_req_{term_name.replace(' ', '')}"
                    if req_id not in all_program_requirements: # Deduplicate requirements
                        all_program_requirements[req_id] = ProgramRequirement(
                            id=req_id,
                            type="ALL",
                            content=term_course_set_id_hint, # Reference the CourseSet ID
                            explanations=[f"Required courses in term {term_name}."]
                        ).to_dict()

                # Process general course_lists from program_plan_output_program
                for list_name, courses_in_list in program_plan_output_program.get("course_lists", {}).items():
                    list_course_set_id_hint = f"course_list_{re.sub(r'[^a-zA-Z0-9_]', '', list_name).lower()}"
                    if list_course_set_id_hint not in all_course_sets: # Deduplicate course sets
                        all_course_sets[list_course_set_id_hint] = {
                            "id_hint": list_course_set_id_hint,
                            "mode": "explicit",
                            "title": list_name,
                            "courses": [c["code"] for c in courses_in_list]
                        }
                    req_id = f"list_req_{re.sub(r'[^a-zA-Z0-9_]', '', list_name)}"
                    if req_id not in all_program_requirements: # Deduplicate requirements
                        all_program_requirements[req_id] = ProgramRequirement(
                            id=req_id,
                            type="ANY", # Assuming these are typically 'any from list'
                            content=list_course_set_id_hint,
                            explanations=[f"Complete courses from {list_name}."]
                        ).to_dict()

            # Accumulate Course Sets (from top-level envelope.course_sets if any, though program-level overrides)
            for cs_data in envelope_data.get("course_sets", []):
                cs_id = cs_data.get("id_hint")
                if cs_id and cs_id not in all_course_sets: # Add only if not already processed from program_shell_data
                    all_course_sets[cs_id] = cs_data

            # Accumulate requirements (from top-level envelope.requirements if any, though program-level overrides)
            for req_data in envelope_data.get("requirements", []):
                # Use 'id' if available, otherwise fall back to 'id_hint'
                req_id = req_data.get("id") or req_data.get("id_hint")
                if req_id and req_id not in all_program_requirements:
                    def convert_req_node_to_dict(node_data: Dict[str, Any]) -> Dict[str, Any]:
                        # Use 'id' or 'id_hint' for the id field
                        node_id = node_data.get("id") or node_data.get("id_hint", "")
                        # Use 'content' if available, otherwise use 'courseSet'
                        content = node_data.get("content") or node_data.get("courseSet")
                        
                        converted = {
                            "id": node_id,
                            "type": node_data.get("type", ""),
                            "content": content,
                            "explanations": node_data.get("explanations", []),
                        }
                        if node_data.get("children"):
                            converted["children"] = [convert_req_node_to_dict(child) for child in node_data["children"]]
                        return converted

                    converted_req = convert_req_node_to_dict(req_data)
                    all_program_requirements[req_id] = converted_req

    # Write output files
    os.makedirs(output_dir, exist_ok=True)

    with open(os.path.join(output_dir, "nodes.json"), "w", encoding="utf-8") as f:
        json.dump([node.to_dict() for node in nodes.values()], f, indent=2, ensure_ascii=False)

    with open(os.path.join(output_dir, "edges.json"), "w", encoding="utf-8") as f:
        json.dump([edge.to_dict() for edge in edges], f, indent=2, ensure_ascii=False)

    # Output aggregated program plan requirements
    program_plan_output = {
        "program": program_plan_output_program,
        "requirements": list(all_program_requirements.values())
    }
    with open(os.path.join(output_dir, "program_plan.json"), "w", encoding="utf-8") as f:
        json.dump(program_plan_output, f, indent=2, ensure_ascii=False)

    # Output aggregated course_sets.json
    with open(os.path.join(output_dir, "course_sets.json"), "w", encoding="utf-8") as f:
        json.dump(list(all_course_sets.values()), f, indent=2, ensure_ascii=False)

    with open(os.path.join(output_dir, "constraints.json"), "w", encoding="utf-8") as f:
        json.dump([], f, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate frontend data from normalized catalog JSONL.")
    parser.add_argument("--in", dest="input_jsonl", required=True, help="Input normalized JSONL path")
    parser.add_argument("--out_dir", dest="output_dir", default="app/public/data", help="Output directory for JSON files")
    args = parser.parse_args()

    generate_frontend_data(args.input_jsonl, args.output_dir)
