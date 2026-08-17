#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UW Kuali Catalog API Client
Fetches STRUCTURED undergraduate course data from the UW academic calendar's
Kuali backend (uwaterloocm.kuali.co).

Unlike scraping rendered pages, this reads the catalog's JSON API directly:
  - GET /api/v1/catalog/courses/<catalogId>            -> lightweight index of every course
  - GET /api/v1/catalog/course/<catalogId>/<pid>       -> full detail for one course

The detail payload carries units/credits, subject, level, description and the
prerequisite / antirequisite / corequisite rules. Those rule fields are small
HTML fragments produced by Kuali's rule builder; each referenced course is an
anchor (``<a href="#/courses/view/<pid>">CS138</a>``) and the boolean structure
is encoded with "Complete all of the following" / "Complete N of the following"
headers. :func:`parse_requirement_html` turns that fragment into a boolean tree
which :mod:`Processing.build_dataset` flattens into graph edges.

Style/patterns intentionally mirror ``Scraper/uwflow_api.py`` (module-level
constants, a dataclass result, small pure functions, a ``main`` CLI).
"""

import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import requests
from bs4 import BeautifulSoup

# UW academic-calendar undergraduate catalog. The catalog id is embedded in the
# calendar SPA (``catalogId = '...'`` in the page source); update it here when
# UW rolls the calendar to a new year.
KUALI_BASE = "https://uwaterloocm.kuali.co/api/v1/catalog"
DEFAULT_CATALOG_ID = "67e557ed6ed2fe2bd3a38956"

# e.g. "CS 138", "cs138", "MATH237" -> group(1)=CS group(2)=138
COURSE_CODE_RE = re.compile(r"^([A-Z]{2,6})\s?(\d{2,4}[A-Z]?)$")
# Same, but for finding codes embedded in free text ("...MSCI121, PHYS236").
BARE_CODE_RE = re.compile(r"\b([A-Z]{2,6})\s?(\d{3}[A-Z]?)\b")


# ---------------------------------------------------------------------------
# Boolean requirement tree
# ---------------------------------------------------------------------------
# A parsed requirement is a nested tuple:
#   ("COURSE", "CS138")           a single course leaf
#   ("CONST", "4U Physics")       a non-course requirement (grade / standing / HS)
#   ("AND", [child, child, ...])  all children required
#   ("OR",  [child, child, ...])  at least one child required
ReqNode = Union[Tuple[str, str], Tuple[str, List["ReqNode"]]]


@dataclass
class KualiCourseResult:
    code: str
    title: Optional[str]
    subject: Optional[str]
    level: Optional[int]
    credits: Optional[float]
    description: Optional[str]
    pid: Optional[str]
    course_id: Optional[str]
    # Raw HTML rule fragments straight from Kuali (kept for provenance/debug).
    prereqs_html: Optional[str]
    antireqs_html: Optional[str]
    coreqs_html: Optional[str]
    # Parsed boolean trees (see ReqNode). None when the field was empty.
    prereq_tree: Optional[ReqNode]
    antireq_tree: Optional[ReqNode]
    coreq_tree: Optional[ReqNode]
    crosslistings: List[str] = field(default_factory=list)
    source_url: str = ""


def normalize_code(code: str) -> str:
    """Uppercase, strip spaces: 'cs 138' -> 'CS138'. '' if it isn't a code."""
    if not code:
        return ""
    m = COURSE_CODE_RE.match(code.strip().upper())
    return (m.group(1) + m.group(2)) if m else ""


def _course_url(catalog_id: str, pid: str) -> str:
    return (
        "https://uwaterloo.ca/academic-calendar/undergraduate-studies/"
        f"catalog#/courses/view/{pid}"
    )


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def fetch_course_index(
    catalog_id: str = DEFAULT_CATALOG_ID,
    session: Optional[requests.Session] = None,
) -> List[Dict[str, Any]]:
    """Return the lightweight index of every course in the catalog.

    Each item looks like::

        {"__catalogCourseId": "CS241", "pid": "B1Z6puV7Yn",
         "id": "...", "title": "...", "subjectCode": {"name": "CS", ...},
         "courseLevel": {"name": "200", ...}}
    """
    sess = session or requests
    url = f"{KUALI_BASE}/courses/{catalog_id}"
    resp = sess.get(url, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        raise ValueError(f"Unexpected course index shape: {type(data)}")
    return data


def fetch_course_detail(
    pid: str,
    catalog_id: str = DEFAULT_CATALOG_ID,
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """Return the full JSON detail for one course by its ``pid``."""
    sess = session or requests
    url = f"{KUALI_BASE}/course/{catalog_id}/{pid}"
    try:
        resp = sess.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:  # noqa: BLE001 - keep going on a single bad course
        print(f"  ! error fetching Kuali pid {pid}: {e}")
        return None


# ---------------------------------------------------------------------------
# Field parsing
# ---------------------------------------------------------------------------
def parse_credits(credits_field: Any) -> Optional[float]:
    """Kuali credits look like {"value": "0.50", "credits": {min,max}}."""
    if not isinstance(credits_field, dict):
        return None
    for key in ("value", "chosen"):
        raw = credits_field.get(key)
        if isinstance(raw, str):
            try:
                return float(raw)
            except ValueError:
                pass
    inner = credits_field.get("credits") or {}
    for key in ("min", "max"):
        raw = inner.get(key)
        if isinstance(raw, str):
            try:
                return float(raw)
            except ValueError:
                pass
    return None


def parse_level(course_level: Any, code: str = "") -> Optional[int]:
    """courseLevel.name is a string like "200"; fall back to the code digits."""
    if isinstance(course_level, dict):
        name = course_level.get("name")
        if isinstance(name, str) and name.isdigit():
            return int(name)
    m = re.search(r"(\d)\d{2}", code)
    if m:
        return int(m.group(0)[0]) * 100
    return None


def _is_branch_header(text: str) -> Optional[str]:
    """Return 'AND'/'OR' if `text` is a Kuali group header, else None.

    Headers read "Complete all of the following" (AND) or
    "Complete N of the following" (OR / choose-N, treated as OR).
    """
    t = " ".join(text.split())
    m = re.match(r"^Complete\s+(all|\d+)\s+of the following", t, re.IGNORECASE)
    if not m:
        return None
    return "AND" if m.group(1).lower() == "all" else "OR"


def _direct_child_lis(ul) -> List[Any]:
    """<li> elements whose nearest enclosing <ul> is exactly `ul`.

    Kuali wraps some list items in stray <div> group separators, so a plain
    ``recursive=False`` misses them; ``find_parent('ul')`` skips the wrappers.
    """
    return [li for li in ul.find_all("li") if li.find_parent("ul") is ul]


def _codes_in(node) -> List[str]:
    codes = []
    for a in node.find_all("a"):
        c = normalize_code(a.get_text(" ", strip=True))
        if c and c not in codes:
            codes.append(c)
    return codes


def _parse_li(li) -> Optional[ReqNode]:
    # Is this a branch node ("Complete all/N of the following ...")?
    header_span = li.find("span", recursive=False)
    if header_span is not None:
        conn = _is_branch_header(header_span.get_text(" ", strip=True))
        if conn:
            sub_ul = li.find("ul")
            children: List[ReqNode] = []
            if sub_ul is not None:
                for child_li in _direct_child_lis(sub_ul):
                    parsed = _parse_li(child_li)
                    if parsed:
                        children.append(parsed)
            if not children:
                return None
            return (conn, children) if len(children) > 1 else children[0]

    # Otherwise it's a leaf "result" block: a flat list of courses (or a
    # non-course requirement such as a high-school course / program / standing).
    text = li.get_text(" ", strip=True)
    codes = _codes_in(li)
    if not codes:
        # Some rule blocks list courses as plain text instead of links
        # (e.g. "Not completed any of the following: MSCI121, PHYS236").
        bare = []
        for m in BARE_CODE_RE.finditer(text):
            c = (m.group(1) + m.group(2)).upper()
            if c not in bare:
                bare.append(c)
        codes = bare
    if not codes:
        return ("CONST", " ".join(text.split()))
    # "at least N of the following" / "one of" => OR; otherwise all required.
    lower = text.lower()
    conn = "OR" if ("at least" in lower or "one of" in lower or "of the following" in lower) else "AND"
    leaves: List[ReqNode] = [("COURSE", c) for c in codes]
    if len(leaves) == 1:
        return leaves[0]
    return (conn, leaves)


def parse_requirement_html(html: Optional[str]) -> Optional[ReqNode]:
    """Parse a Kuali prereq/antireq/coreq HTML fragment into a boolean tree."""
    if not html or not html.strip():
        return None
    soup = BeautifulSoup(html, "html.parser")
    top_ul = soup.find("ul")
    if top_ul is None:
        # Rare: plain-text requirement with no list markup.
        text = soup.get_text(" ", strip=True)
        return ("CONST", " ".join(text.split())) if text else None
    children: List[ReqNode] = []
    for li in _direct_child_lis(top_ul):
        parsed = _parse_li(li)
        if parsed:
            children.append(parsed)
    if not children:
        return None
    return ("AND", children) if len(children) > 1 else children[0]


def _extract_crosslistings(description: Optional[str]) -> List[str]:
    """Pull codes out of "(Cross-listed with X)" / "Also offered as X" notes."""
    if not description:
        return []
    codes: List[str] = []
    for m in re.finditer(
        r"(?:cross-?listed with|also offered as)\s*([A-Z]{2,6}\s?\d{2,4}[A-Z]?"
        r"(?:\s*(?:,|and|/)\s*[A-Z]{2,6}\s?\d{2,4}[A-Z]?)*)",
        description,
        re.IGNORECASE,
    ):
        for part in re.split(r",|and|/", m.group(1)):
            c = normalize_code(part)
            if c and c not in codes:
                codes.append(c)
    return codes


def parse_course_detail(detail: Dict[str, Any], catalog_id: str) -> Optional[KualiCourseResult]:
    """Turn a raw Kuali detail payload into a :class:`KualiCourseResult`."""
    code = normalize_code(detail.get("__catalogCourseId", ""))
    if not code:
        return None
    subject = (detail.get("subjectCode") or {}).get("name")
    description = detail.get("description")
    prereqs_html = detail.get("prerequisites")
    antireqs_html = detail.get("antirequisites")
    coreqs_html = detail.get("corequisites")
    return KualiCourseResult(
        code=code,
        title=detail.get("title"),
        subject=subject,
        level=parse_level(detail.get("courseLevel"), code),
        credits=parse_credits(detail.get("credits")),
        description=description,
        pid=detail.get("pid"),
        course_id=detail.get("id"),
        prereqs_html=prereqs_html,
        antireqs_html=antireqs_html,
        coreqs_html=coreqs_html,
        prereq_tree=parse_requirement_html(prereqs_html),
        antireq_tree=parse_requirement_html(antireqs_html),
        coreq_tree=parse_requirement_html(coreqs_html),
        crosslistings=_extract_crosslistings(description),
        source_url=_course_url(catalog_id, detail.get("pid", "")),
    )


# ---------------------------------------------------------------------------
# High-level fetch
# ---------------------------------------------------------------------------
def fetch_all_courses(
    catalog_id: str = DEFAULT_CATALOG_ID,
    subjects: Optional[List[str]] = None,
    limit: Optional[int] = None,
    workers: int = 8,
    progress: bool = True,
) -> List[KualiCourseResult]:
    """Fetch and parse every course (optionally filtered to `subjects`).

    Details are fetched concurrently with a small thread pool to stay polite.
    """
    session = requests.Session()
    session.headers.update({"User-Agent": "course-connect-data-pipeline/1.0"})

    index = fetch_course_index(catalog_id, session)
    if subjects:
        wanted = {s.upper() for s in subjects}
        index = [
            it for it in index
            if (it.get("subjectCode") or {}).get("name", "").upper() in wanted
        ]
    if limit:
        index = index[:limit]

    total = len(index)
    if progress:
        print(f"Kuali: fetching {total} course details ({workers} workers)...")

    results: List[KualiCourseResult] = []

    def _one(item: Dict[str, Any]) -> Optional[KualiCourseResult]:
        pid = item.get("pid")
        if not pid:
            return None
        detail = fetch_course_detail(pid, catalog_id, session)
        if not detail:
            return None
        return parse_course_detail(detail, catalog_id)

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_one, it): it for it in index}
        for fut in as_completed(futures):
            done += 1
            res = fut.result()
            if res:
                results.append(res)
            if progress and done % 200 == 0:
                print(f"  ...{done}/{total}")

    results.sort(key=lambda r: r.code)
    if progress:
        print(f"Kuali: parsed {len(results)}/{total} courses.")
    return results


def _serialize(result: KualiCourseResult) -> Dict[str, Any]:
    """asdict, but keep the boolean trees JSON-friendly (they already are)."""
    return asdict(result)


def main():
    parser = argparse.ArgumentParser(description="Fetch structured courses from the UW Kuali catalog")
    parser.add_argument("--catalog-id", default=DEFAULT_CATALOG_ID, help="Kuali catalog id")
    parser.add_argument("--subjects", nargs="*", help="Limit to these subject codes (e.g. CS MATH SE)")
    parser.add_argument("--limit", type=int, default=None, help="Max courses (for testing)")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent detail fetches")
    parser.add_argument("--out", default="kuali_courses.jsonl", help="Output JSONL path")
    args = parser.parse_args()

    t0 = time.time()
    results = fetch_all_courses(
        catalog_id=args.catalog_id,
        subjects=args.subjects,
        limit=args.limit,
        workers=args.workers,
    )
    out_path = Path(args.out)
    with open(out_path, "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(_serialize(r), ensure_ascii=False) + "\n")
    print(f"Wrote {len(results)} courses -> {out_path} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
