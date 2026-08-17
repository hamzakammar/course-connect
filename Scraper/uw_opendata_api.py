#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UW Open Data API v3 Client (https://openapi.data.uwaterloo.ca)

Adds LIVE seat counts and a bit of extra course metadata to the pipeline.
Every request needs an API key sent as the ``X-API-KEY`` header; the key is read
from the ``UW_OPENDATA_KEY`` environment variable and is NEVER hardcoded. Get a
free key at https://openapi.data.uwaterloo.ca/ .

If the key is absent the module degrades gracefully: :func:`fetch_seats_by_code`
returns an empty dict and the caller simply omits seat fields.

Endpoints used (confirmed against the live v3 swagger):
  - GET /v3/Terms/current                     -> current term (termCode)
  - GET /v3/Courses/{termCode}                -> courseId -> subject/catalogNumber
  - GET /v3/ClassSchedules/{termCode}         -> per-section maxEnrollmentCapacity
                                                 / enrolledStudents (seats)

Seat counts are aggregated per course code across that course's primary
(lecture-like) sections.
"""

import argparse
import json
import os
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional

import requests

OPENDATA_BASE = "https://openapi.data.uwaterloo.ca/v3"
API_KEY_ENV = "UW_OPENDATA_KEY"

# Section components that represent the "primary" offering whose seats we count.
# Aggregating every tutorial/lab section would double-count enrollment.
PRIMARY_COMPONENTS = {"LEC", "ONLINE ASSIGNMENTS", "SEM", "FLIP", "PRJ", "STU", "RDG", "IND"}


def get_api_key() -> Optional[str]:
    key = os.environ.get(API_KEY_ENV, "").strip()
    return key or None


def _get(path: str, api_key: str, session: Optional[requests.Session] = None) -> Any:
    sess = session or requests
    resp = sess.get(
        f"{OPENDATA_BASE}/{path.lstrip('/')}",
        headers={"X-API-KEY": api_key, "Accept": "application/json"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def get_current_term_code(api_key: str, session: Optional[requests.Session] = None) -> Optional[str]:
    """Return the current term code (e.g. "1259"), or None on failure."""
    try:
        data = _get("Terms/current", api_key, session)
    except Exception as e:  # noqa: BLE001
        print(f"OpenData: could not fetch current term: {e}")
        return None
    if isinstance(data, list) and data:
        data = data[0]
    if isinstance(data, dict):
        return data.get("termCode")
    return None


def _norm(subject: Optional[str], catalog_number: Optional[str]) -> str:
    if not subject or not catalog_number:
        return ""
    return f"{subject}{catalog_number}".upper().replace(" ", "")


def fetch_seats_by_code(
    term_code: Optional[str] = None,
    api_key: Optional[str] = None,
    session: Optional[requests.Session] = None,
) -> Dict[str, Dict[str, Any]]:
    """Return {normalized_code: {enrolled, capacity, sections, term}}.

    Empty dict (and a printed note) when no API key is configured, so callers
    can treat seats as optional without special-casing.
    """
    api_key = api_key or get_api_key()
    if not api_key:
        print(
            f"OpenData: ${API_KEY_ENV} not set - skipping live seat counts. "
            "Set it (see .env.example) to include seats."
        )
        return {}

    sess = session or requests.Session()

    if not term_code:
        term_code = get_current_term_code(api_key, sess)
    if not term_code:
        print("OpenData: no term code available - skipping seats.")
        return {}

    # courseId -> normalized course code
    try:
        courses = _get(f"Courses/{term_code}", api_key, sess)
    except Exception as e:  # noqa: BLE001
        print(f"OpenData: could not fetch Courses/{term_code}: {e}")
        return {}
    id_to_code: Dict[str, str] = {}
    for c in courses or []:
        code = _norm(c.get("subjectCode"), c.get("catalogNumber"))
        cid = c.get("courseId")
        if code and cid:
            id_to_code[cid] = code

    # per-section seat counts
    try:
        classes = _get(f"ClassSchedules/{term_code}", api_key, sess)
    except Exception as e:  # noqa: BLE001
        print(f"OpenData: could not fetch ClassSchedules/{term_code}: {e}")
        return {}

    agg: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"enrolled": 0, "capacity": 0, "sections": 0, "term": term_code}
    )
    for cls in classes or []:
        cid = cls.get("courseId")
        code = id_to_code.get(cid)
        if not code:
            continue
        component = (cls.get("courseComponent") or "").upper()
        if component and component not in PRIMARY_COMPONENTS:
            continue
        cap = cls.get("maxEnrollmentCapacity")
        enr = cls.get("enrolledStudents")
        if isinstance(cap, int):
            agg[code]["capacity"] += cap
        if isinstance(enr, int):
            agg[code]["enrolled"] += enr
        agg[code]["sections"] += 1

    result = {k: dict(v) for k, v in agg.items()}
    print(f"OpenData: aggregated seats for {len(result)} courses (term {term_code}).")
    return result


def main():
    parser = argparse.ArgumentParser(description="Fetch live seat counts from UW Open Data")
    parser.add_argument("--term", default=None, help="Term code (default: current)")
    parser.add_argument("--out", default="uw_seats.json", help="Output JSON path")
    args = parser.parse_args()

    seats = fetch_seats_by_code(term_code=args.term)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(seats, f, indent=2, ensure_ascii=False)
    print(f"Wrote seats for {len(seats)} courses -> {args.out}")


if __name__ == "__main__":
    main()
