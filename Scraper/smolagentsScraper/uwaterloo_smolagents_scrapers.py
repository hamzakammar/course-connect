# uwaterloo_smolagents_scrapers.py
# General Waterloo Academic Calendar scrapers built as smolagents Tools.
# - ProgramListsScraper: finds "Course Lists" blocks and all courses inside each list
# - CourseDetailsScraper: pulls course details from Kuali JSON (with SPA network capture)
#
# Usage examples are at bottom (CLI).

import json
import re
import time
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple, Any

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

# smolagents imports (we use Tool API so these can be plugged into an agent)
from smolagents import Tool

# -------------------------
# Helpers
# -------------------------

COURSE_CODE_RE = re.compile(r"\b([A-Z]{2,8})\s?(\d{2,3}[A-Z]?)\b")

def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def _guess_units_from_text(text: str) -> Optional[str]:
    m = re.search(r"\((\d+\.\d{2})\)\s*$", text)
    return m.group(1) if m else None

def _is_heading(tag) -> bool:
    if not getattr(tag, "name", None):
        return False
    if re.match(r"^h[1-6]$", tag.name, re.I):
        return True
    if tag.get("role", "").lower() == "heading":
        return True
    classes = " ".join(tag.get("class") or []).lower()
    return "heading" in classes or "title" in classes

def _heading_level(tag) -> int:
    if getattr(tag, "name", None) and re.match(r"^h[1-6]$", tag.name, re.I):
        return int(tag.name[1])
    if tag.get("aria-level"):
        try:
            return int(tag.get("aria-level"))
        except Exception:
            pass
    return 6  # treat as lowest priority if unknown

def _looks_like_list_title(text: str) -> bool:
    t = _clean_text(text).lower()
    if not t:
        return False
    if t in {
        "undergraduate communication requirement",
        "communication requirement",
        "natural science list",
        "natural sciences list",
        "technical electives list",
        "technical electives",
        "complementary studies electives",
        "complementary studies elective list",
        "additional requirements",
        "additional requirement",
    }:
        return True
    if re.search(r"\blist\s*[1-9]\b", t):
        return True
    if "list" in t and any(k in t for k in ["natural", "science", "technical", "elective", "complementary"]):
        return True
    return False

def _is_requirements_bucket(text: str) -> bool:
    return _clean_text(text).lower() in {"course requirements", "course requirement"}

def _is_course_list_title(t: str) -> bool:
    tl = t.strip().lower()
    if not tl:
        return False
    # allow-list typical list section names
    allow_exact = {
        "undergraduate communication requirement",
        "communication requirement",
        "natural science list",
        "natural sciences list",
        "technical electives list",
        "technical electives",
        "complementary studies electives",
        "complementary studies elective list",
        "additional requirements",  # (contains sustainability list)
    }
    if tl in allow_exact:
        return True
    # “List 1/2/3…”
    if re.search(r"\blist\s*[1-9]\b", tl):
        return True
    # Generic “<something> list” with relevant keywords
    if "list" in tl and any(k in tl for k in ["natural", "science", "technical", "elective", "complementary"]):
        return True
    return False

def _collect_until_next_heading(start_node, max_level: int) -> str:
    """Collect HTML from siblings after start_node until next heading of level <= max_level."""
    parts = []
    node = start_node.next_sibling
    while node:
        if getattr(node, "name", None) and _is_heading(node) and _heading_level(node) <= max_level:
            break
        parts.append(str(node))
        node = node.next_sibling
    return "".join(parts)

def _course_nodes_in_container(container) -> List[Tuple[str, str, Optional[str]]]:
    """
    Return list of (row_text, course_id, href).
    Find anchors to '#/courses/view/' and read the row (li/p/div/tr) text so
    title/units outside the <a> are captured too.
    """
    results = []
    for a in container.select('a[href*="#/courses/view/"]'):
        href = a.get("href", "")
        cid = href.split("#/courses/view/")[-1]
        row = a.find_parent(["li", "tr", "p", "div"]) or a
        text = _clean_text(row.get_text(" ", strip=True)) or _clean_text(a.get_text(" ", strip=True))
        results.append((text, cid, href))
    return results

def _extract_heading_text(tag) -> str:
    return _clean_text(tag.get_text(" ", strip=True))

def _standardize_list_title(t: str) -> str:
    # Normalize frequent variations so downstream matching is easier
    t_norm = t.replace("  ", " ")
    t_norm = t_norm.replace("–", "-").replace("—", "-")
    return t_norm

def _unique(seq):
    seen = set()
    out = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out

# -------------------------
# Browser tool (Playwright)
# -------------------------

class BrowserFetchTool(Tool):
    name = "browser_fetch"
    description = "Open a page with Playwright and return HTML plus captured JSON payloads."
    inputs = {
        "url": {
            "type": "string",
            "description": "Page URL to open",
            "nullable": True,
        },
        "max_wait_ms": {
            "type": "number",
            "description": "Max extra wait after load (ms). Default 4000.",
            "nullable": True,
        },
        "kuali_only": {
            "type": "boolean",
            "description": "If true, only keep JSON from uwaterloocm.kuali.co.",
            "nullable": True,
        },
        "headless": {
            "type": "boolean",
            "description": "Run headless browser. Default True.",
            "nullable": True,
        },
    }
    output_type = "string"

    def forward(
        self,
        url: str = None,
        max_wait_ms: int = 4000,
        kuali_only: bool = True,
        headless: bool = True,
    ) -> str:
        if not url:
            raise ValueError("URL is required")
        blobs: List[Dict[str, Any]] = []
        html: str = ""

        def _resp_handler(resp):
            try:
                ctype = (resp.headers or {}).get("content-type", "")
                if "application/json" in ctype.lower():
                    u = resp.url
                    if (not kuali_only) or ("uwaterloocm.kuali.co" in u):
                        try:
                            data = resp.json()
                            blobs.append({"url": u, "json": data})
                        except Exception:
                            pass
            except Exception:
                pass

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)
            context = browser.new_context()
            page = context.new_page()

            page.on("response", _resp_handler)

            try:
                page.goto(url, wait_until="networkidle", timeout=30000)
            except PWTimeoutError:
                # still proceed; SPA sometimes never reaches strict network idle due to analytics
                pass

            # Let the app settle & network calls fire
            time.sleep(max_wait_ms / 1000.0)

            try:
                html = page.content()
            except Exception:
                html = ""

            page.close()
            context.close()
            browser.close()

        result = {"html": html, "json_blobs": blobs, "url": url}
        # For agent compatibility, return a JSON string.
        return json.dumps(result, ensure_ascii=False)


# -------------------------
# Program Lists scraper
# -------------------------
class ProgramListsScraper(Tool):
    name = "program_lists_scraper"
    description = (
        "Scrape 'Course Lists' on a Waterloo Academic Calendar PROGRAM page "
        "and return all lists and their courses."
    )
    inputs = {
        "html": {"type": "string", "description": "HTML content to parse", "nullable": True},
        "base_url": {"type": "string", "description": "Base URL for relative links", "nullable": True},
    }
    output_type = "string"

    def forward(self, html: str = None, base_url: str = "https://uwaterloo.ca") -> str:
        if not html:
            raise ValueError("HTML content is required")
        soup = BeautifulSoup(html, "lxml")

        # 1) Collect all potential list titles in DOM order (any tag, not only <h*>)
        header_nodes = []
        for tag in soup.find_all(True):
            # skip tiny tags to avoid noise
            if not getattr(tag, "get_text", None):
                continue
            txt = _clean_text(tag.get_text(" ", strip=True))
            if not txt:
                continue
            if _looks_like_list_title(txt) and not _is_requirements_bucket(txt):
                header_nodes.append((tag, _standardize_list_title(txt)))

        # If we found nothing, return empty early
        if not header_nodes:
            return json.dumps({"course_lists": {}}, ensure_ascii=False)

        # 2) Collect all course anchors in DOM order (global)
        anchors = soup.select('a[href*="#/courses/view/"]')

        lists_out: Dict[str, Dict[str, Any]] = {}
        # Pre-create list buckets with order preserved
        for _, title in header_nodes:
            if title not in lists_out:
                lists_out[title] = {"list_name": title, "courses": []}

        # 3) For each course anchor, assign it to the nearest preceding list title
        # Build a fast set of header elements for identity checks
        header_tags = [hn for hn, _ in header_nodes]
        header_set = set(header_tags)

        for a in anchors:
            href = a.get("href", "")
            if "#/courses/view/" not in href:
                continue
            cid = href.split("#/courses/view/")[-1]
            # Prefer the full row text around the anchor
            row = a.find_parent(["li", "tr", "p", "div"]) or a
            text = _clean_text(row.get_text(" ", strip=True)) or _clean_text(a.get_text(" ", strip=True))

            # Find the closest *previous* header candidate in document order
            assigned_title = None
            for prev in a.previous_elements:
                if prev in header_set:
                    # map to the normalized title string
                    idx = header_tags.index(prev)
                    assigned_title = header_nodes[idx][1]
                    break
            if not assigned_title:
                # no preceding list title → skip (likely belongs to core requirements)
                continue

            # Parse code/title/units from text
            units = _guess_units_from_text(text)
            if " - " in text:
                code_part, title_part = text.split(" - ", 1)
            else:
                m = COURSE_CODE_RE.search(text)
                if m:
                    code_part = f"{m.group(1)} {m.group(2)}"
                    title_part = text[m.end():].strip(" -")
                else:
                    code_part, title_part = text, ""
            code_part = _clean_text(code_part)
            title_part = re.sub(r"\(\s*\d+\.\d{2}\s*\)\s*$", "", title_part).strip()
            m = COURSE_CODE_RE.search(code_part)
            code_std = f"{m.group(1)} {m.group(2)}" if m else code_part

            # Dedup within a list by course_id while preserving first occurrence
            bucket = lists_out[assigned_title]["courses"]
            if not any(c["course_id"] == cid for c in bucket):
                bucket.append({
                    "course_id": cid,
                    "code": code_std,
                    "title": title_part or None,
                    "units": units,
                    "href": href,
                })

        # 4) Drop empty lists and return
        lists_out = {k: v for k, v in lists_out.items() if v["courses"]}
        return json.dumps({"course_lists": lists_out}, ensure_ascii=False)

# -------------------------
# Kuali JSON parsing for course pages
# -------------------------

def _first_json_that_has(docs: List[Dict[str, Any]], key: str) -> Optional[Dict[str, Any]]:
    for d in docs:
        try:
            if isinstance(d.get("json"), dict) and key in d["json"]:
                return d["json"]
        except Exception:
            continue
    return None

def _extract_course_fields_from_json(j: Dict[str, Any]) -> Dict[str, Any]:
    """
    Kuali course JSON varies by tenant/version. We try a few common field paths.
    """
    out = {}
    try:
        data = j.get("data") or j
        attributes = data.get("attributes") or data

        subj = attributes.get("subjectCode") or attributes.get("subject") or ""
        num = attributes.get("number") or attributes.get("code") or ""
        code = f"{subj} {num}".strip() if subj or num else None

        title = (
            attributes.get("title")
            or attributes.get("course_title")
            or attributes.get("name")
        )

        units = None
        credits = attributes.get("credits") or attributes.get("units")
        if isinstance(credits, dict):
            units = str(credits.get("min") or credits.get("max") or "")
        elif credits:
            units = str(credits)

        description = attributes.get("description") or attributes.get("desc")

        prereq = attributes.get("prerequisites") or attributes.get("preRequisites") or attributes.get("prereq")
        coreq = attributes.get("corequisites") or attributes.get("coRequisites") or attributes.get("coreq")
        antireq = attributes.get("antirequisites") or attributes.get("antiRequisites") or attributes.get("antireq")

        out.update(
            code=code,
            title=title,
            units=units,
            description=description,
            prerequisites=prereq,
            corequisites=coreq,
            antirequisites=antireq,
        )
    except Exception:
        pass

    return out

def _extract_reqs_from_dom(html: str) -> Dict[str, Optional[str]]:
    """
    Fallback if JSON didn’t expose requisites plainly: pull visible text blocks.
    """
    soup = BeautifulSoup(html, "lxml")
    def grab(label: str) -> Optional[str]:
        lab = soup.find(lambda tag: tag.name in ["h3","h4","strong","b"] and _clean_text(tag.get_text()).lower()==label.lower())
        if not lab:
            lab = soup.find(string=re.compile(rf"^{re.escape(label)}", re.I))
            if lab and lab.parent:
                blk = _clean_text(lab.parent.get_text(" ", strip=True))
                return blk
            return None
        txts = []
        for sib in lab.parent.next_siblings:
            if getattr(sib, "name", None) and re.match(r"^h[1-4]$", sib.name, re.I):
                break
            txts.append(_clean_text(BeautifulSoup(str(sib), "lxml").get_text(" ", strip=True)))
        joined = " ".join(t for t in txts if t).strip()
        return joined or None

    return {
        "prerequisites": grab("Prerequisites"),
        "corequisites": grab("Corequisites"),
        "antirequisites": grab("Antirequisites"),
    }

class CourseDetailsScraper(Tool):
    name = "course_details_scraper"
    description = (
        "Scrape a Waterloo Academic Calendar COURSE page for title, units, description, prerequisites, "
        "corequisites, antirequisites. Captures Kuali JSON via network."
    )
    inputs = {
        "browser_payload": {"type": "string", "description": "JSON payload from browser fetch", "nullable": True},
        "list_membership": {"type": "string", "description": "Optional list membership data", "nullable": True},
    }
    output_type = "string"

    def forward(self, browser_payload: str = None, list_membership: str = "") -> str:
        if not browser_payload:
            raise ValueError("Browser payload is required")
        payload = json.loads(browser_payload)
        html = payload.get("html", "")
        blobs = payload.get("json_blobs", [])

        # Find a JSON blob that looks like a course object
        course_json = None
        for b in blobs:
            j = b.get("json")
            if not isinstance(j, dict):
                continue
            cand = j.get("data") if isinstance(j.get("data"), dict) else j
            attrs = cand.get("attributes") if isinstance(cand.get("attributes"), dict) else cand
            if any(k in attrs for k in ["title", "subjectCode", "number", "description"]):
                course_json = j
                break

        out = {
            "course_id": None,
            "code": None,
            "title": None,
            "units": None,
            "description": None,
            "prerequisites": None,
            "corequisites": None,
            "antirequisites": None,
            "lists": [],
            "source_url": payload.get("url"),
            "json_captured": course_json is not None
        }

        # course_id: derive from URL fragment if present
        url = payload.get("url") or ""
        if "#/courses/view/" in url:
            out["course_id"] = url.split("#/courses/view/")[-1]

        if course_json:
            fields = _extract_course_fields_from_json(course_json)
            for k, v in fields.items():
                if v:
                    out[k] = v

        # Fallbacks
        if not out["title"] or not out["description"]:
            soup = BeautifulSoup(html, "lxml")
            h1 = soup.find("h1") or soup.find("h2")
            if h1:
                out["title"] = _clean_text(h1.get_text(" ", strip=True))
            desc_label = soup.find(lambda t: t.name in ["h3","h4","strong","b"] and "description" in t.get_text(strip=True).lower())
            if desc_label:
                parts = []
                for sib in desc_label.parent.next_siblings:
                    if getattr(sib, "name", None) and re.match(r"^h[1-4]$", sib.name, re.I):
                        break
                    parts.append(_clean_text(BeautifulSoup(str(sib), "lxml").get_text(" ", strip=True)))
                out["description"] = " ".join(p for p in parts if p) or out["description"]

        # If requisites are missing, try DOM text
        if not any([out["prerequisites"], out["corequisites"], out["antirequisites"]]):
            reqs = _extract_reqs_from_dom(html)
            for k, v in reqs.items():
                if v:
                    out[k] = v

        # lists membership (optional input): {list_name: [course_id, ...], ...}
        if list_membership and out.get("course_id"):
            try:
                lm = json.loads(list_membership)
                cid = out["course_id"]
                # preserve program list order (no alphabetical sort)
                membership_seq = []
                for lname, ids in lm.items():  # dict preserves insertion order
                    try:
                        idset = set(ids)
                    except TypeError:
                        idset = set(ids or [])
                    if cid in idset:
                        membership_seq.append(lname)
                out["lists"] = membership_seq
            except Exception:
                pass

        return json.dumps(out, ensure_ascii=False)


# -------------------------
# Convenience runner fns (no LLM needed)
# -------------------------

def scrape_program_lists(program_url: str, headless: bool = True) -> Dict[str, Any]:
    """Open a program URL and return {course_lists:{list_name: {list_name, courses:[...]}}}"""
    browser = BrowserFetchTool()
    lists_tool = ProgramListsScraper()

    payload_str = browser.forward(url=program_url, headless=headless, max_wait_ms=4500, kuali_only=False)
    payload = json.loads(payload_str)
    html = payload["html"]

    lists_json_str = lists_tool.forward(html=html, base_url="https://uwaterloo.ca")
    return json.loads(lists_json_str)

def scrape_course_details(course_url: str, list_membership: Optional[Dict[str, List[str]]] = None, headless: bool = True) -> Dict[str, Any]:
    """Open a course URL and return full details dict. Optionally pass list_membership to tag list names."""
    browser = BrowserFetchTool()
    course_tool = CourseDetailsScraper()

    payload_str = browser.forward(url=course_url, headless=headless, max_wait_ms=4500, kuali_only=True)
    lm_str = json.dumps(list_membership) if list_membership else ""
    result_str = course_tool.forward(browser_payload=payload_str, list_membership=lm_str)
    return json.loads(result_str)

# -------------------------
# CLI
# -------------------------

if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description="Waterloo Academic Calendar scrapers (smolagents-style tools).")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("program", help="Scrape Course Lists from a program page.")
    p1.add_argument("program_url", help="e.g., https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/<id>")
    p1.add_argument("-o", "--out", default="program_lists.json")
    p1.add_argument("--headful", action="store_true", help="Run browser non-headless for debugging")

    p2 = sub.add_parser("course", help="Scrape a single course page for details.")
    p2.add_argument("course_url", help="e.g., https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/courses/view/<id>")
    p2.add_argument("-o", "--out", default="course.json")
    p2.add_argument("--lists", default="", help="Optional path to program_lists.json to annotate list membership")
    p2.add_argument("--headful", action="store_true", help="Run browser non-headless for debugging")

    p3 = sub.add_parser("courses_from_program", help="Scrape *all* courses that appear inside a program's Course Lists.")
    p3.add_argument("program_url")
    p3.add_argument("-o", "--out", default="courses_from_program.jsonl")
    p3.add_argument("--headful", action="store_true")

    args = parser.parse_args()

    if args.cmd == "program":
        data = scrape_program_lists(args.program_url, headless=not args.headful)
        Path(args.out).write_text(json.dumps(data, indent=2, ensure_ascii=False))
        print(f"[OK] Wrote Course Lists → {args.out}")

    elif args.cmd == "course":
        list_map = None
        if args.lists:
            try:
                lists_data = json.loads(Path(args.lists).read_text())
                # Build membership map: list_name -> [course_id,...]
                lm = {}
                for lname, block in (lists_data.get("course_lists") or {}).items():
                    lm[lname] = [c["course_id"] for c in block.get("courses", []) if c.get("course_id")]
                list_map = lm
            except Exception:
                pass

        data = scrape_course_details(args.course_url, list_membership=list_map, headless=not args.headful)
        Path(args.out).write_text(json.dumps(data, indent=2, ensure_ascii=False))
        print(f"[OK] Wrote course → {args.out}")

    elif args.cmd == "courses_from_program":
        lists_data = scrape_program_lists(args.program_url, headless=not args.headful)

        # Preserve the order of lists as they appear on the page
        course_lists_block: Dict[str, Any] = (lists_data.get("course_lists") or {})
        list_names_in_order: List[str] = list(course_lists_block.keys())

        # Build membership map (preserves list order)
        list_map: Dict[str, List[str]] = {}
        for lname in list_names_in_order:
            block = course_lists_block.get(lname) or {}
            list_map[lname] = [c["course_id"] for c in (block.get("courses") or []) if c.get("course_id")]

        # Build an ordered sequence of (first_list, course_id), deduped across lists.
        ordered_pairs: List[Tuple[str, str]] = []
        seen: set = set()
        for lname in list_names_in_order:
            for cid in list_map[lname]:
                if cid not in seen:
                    ordered_pairs.append((lname, cid))
                    seen.add(cid)

        base = "https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/courses/view/"
        print(f"Found {len(ordered_pairs)} unique course IDs from Course Lists (ordered by first list).")
        out_path = Path(args.out)

        with out_path.open("w", encoding="utf-8") as f:
            for i, (first_list, cid) in enumerate(ordered_pairs, 1):
                url = base + cid
                try:
                    d = scrape_course_details(url, list_membership=list_map, headless=not args.headful)
                    # annotate the first_list that determined ordering
                    d["first_list"] = first_list
                    f.write(json.dumps(d, ensure_ascii=False) + "\n")
                    print(f"[{i}/{len(ordered_pairs)}] {first_list} :: {d.get('code') or cid}  JSON={d.get('json_captured')}")
                except Exception as e:
                    print(f"[{i}/{len(ordered_pairs)}] {first_list} :: {cid} ERROR: {e}")

        print(f"[OK] Wrote {len(ordered_pairs)} courses → {out_path}")
