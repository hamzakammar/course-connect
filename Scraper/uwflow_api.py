#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UWFlow GraphQL API Client
Fetches course data including prerequisites and ratings from uwflow.com/graphql
"""

import json
import requests
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Any

UWFLOW_GRAPHQL_URL = "https://uwflow.com/graphql"

@dataclass
class UWFlowCourseResult:
    code: str
    name: Optional[str]
    description: Optional[str]
    prereqs: Optional[str]
    coreqs: Optional[str]
    antireqs: Optional[str]
    rating_liked: Optional[float]
    rating_easy: Optional[float]
    rating_useful: Optional[float]
    rating_filled_count: Optional[int]
    rating_comment_count: Optional[int]
    prerequisite_courses: List[Dict[str, str]]  # List of {code, name}
    source_url: str

def fetch_course_graphql(course_code: str) -> Optional[Dict[str, Any]]:
    normalized_code = course_code.lower().replace(' ', '')
    
    query = """
    query getCourse($code: String) {
      course(where: {code: {_eq: $code}}) {
        code
        name
        description
        prereqs
        coreqs
        antireqs
        rating {
          liked
          easy
          useful
          filled_count
          comment_count
        }
        prerequisites {
          prerequisite {
            code
            name
          }
        }
      }
    }
    """
    
    variables = {"code": normalized_code}
    
    payload = {
        "query": query,
        "variables": variables
    }
    
    try:
        response = requests.post(
            UWFLOW_GRAPHQL_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        response.raise_for_status()
        data = response.json()
        
        if "errors" in data:
            print(f"GraphQL errors for {course_code}: {data['errors']}")
            return None
        
        course = data.get("data", {}).get("course", [])
        if not course:
            print(f"  No course found for {course_code} (normalized: {normalized_code})")
            return None
        
        return course[0] if isinstance(course, list) else course
    except Exception as e:
        print(f"Error fetching {course_code}: {e}")
        return None

def fetch_course(course_code: str) -> Optional[UWFlowCourseResult]:
    """Fetch and parse a single course from UWFlow"""
    course_data = fetch_course_graphql(course_code)
    
    if not course_data:
        return None
    
    rating = course_data.get("rating", {})
    prerequisite_courses = []
    
    for prereq_rel in course_data.get("prerequisites", []):
        prereq = prereq_rel.get("prerequisite", {})
        if prereq:
            prerequisite_courses.append({
                "code": prereq.get("code", ""),
                "name": prereq.get("name", "")
            })
    
    return UWFlowCourseResult(
        code=course_data.get("code", course_code.upper()),
        name=course_data.get("name"),
        description=course_data.get("description"),
        prereqs=course_data.get("prereqs"),
        coreqs=course_data.get("coreqs"),
        antireqs=course_data.get("antireqs"),
        rating_liked=rating.get("liked"),
        rating_easy=rating.get("easy"),
        rating_useful=rating.get("useful"),
        rating_filled_count=rating.get("filled_count"),
        rating_comment_count=rating.get("comment_count"),
        prerequisite_courses=prerequisite_courses,
        source_url=f"https://uwflow.com/course/{course_data.get('code', course_code).lower()}"
    )

def fetch_multiple_courses(course_codes: List[str], output_path: Path):
    """Fetch multiple courses from UWFlow"""
    results = []
    
    for i, code in enumerate(course_codes, 1):
        print(f"[{i}/{len(course_codes)}] Fetching {code}...")
        result = fetch_course(code)
        if result:
            results.append(asdict(result))
            print(f"  ✓ {result.code}: {result.name or 'No name'}")
            if result.rating_liked is not None:
                print(f"    Rating: {result.rating_liked:.1%} liked, {result.rating_easy:.1%} easy, {result.rating_useful:.1%} useful")
            if result.prerequisite_courses:
                print(f"    Prerequisites: {', '.join([p['code'] for p in result.prerequisite_courses])}")
        else:
            print(f"  ✗ Failed to fetch {code}")
    
    # Write results to JSONL
    with open(output_path, 'w', encoding='utf-8') as f:
        for result in results:
            f.write(json.dumps(result, ensure_ascii=False) + '\n')
    
    print(f"\nDone! Fetched {len(results)}/{len(course_codes)} courses. Output → {output_path}")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Fetch course data from UWFlow GraphQL API")
    parser.add_argument("courses", nargs="+", help="Course codes (e.g., cs449 cs241 CS 146)")
    parser.add_argument("--out", default="uwflow_courses.jsonl", help="Output JSONL path")
    args = parser.parse_args()
    
    fetch_multiple_courses(args.courses, Path(args.out))

if __name__ == "__main__":
    main()

