# uw_se_scraper_v2.py
# Python 3.11+ recommended
# pip install playwright
# playwright install

import asyncio
import json
import re
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple, Any

from playwright.async_api import async_playwright

PROGRAM_URL = "https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/H1zle10Cs3?searchTerm=software%20engineering&bc=true&bcCurrent=Software%20Engineering%20(Bachelor%20of%20Software%20Engineering%20-%20Honours)&bcItemType=programs"
COURSE_LINK_HREF_PART = "#/courses/view/"

# ---- Helpers ---------------------------------------------------------------

CODE_RE = re.compile(r"\b([A-Z]{2,5})\s*-?\s*(\d{2,3}[A-Z]?)\b")  # e.g., CS 241, MATH119, ECE 105A

def normalize_code(text: str) -> Optional[str]:
    m = CODE_RE.search(text.replace("\xa0", " "))
    if not m:
        return None
    subj, num = m.group(1), m.group(2)
    return f"{subj} {num}"

def uniq(seq):
    seen = set()
    for x in seq:
        if x not in seen:
            seen.add(x)
            yield x

def clean_text(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = re.sub(r"\s+", " ", s).strip()
    return s or None

def join_texts(texts: List[str]) -> Optional[str]:
    texts = [clean_text(t) for t in texts if clean_text(t)]
    return clean_text(" ".join(texts)) if texts else None

@dataclass
class CourseResult:
    course_id: str                   # hash id from the href
    code: Optional[str]              # "CS 241"
    title: Optional[str]             # title from page heading
    units: Optional[str]
    description: Optional[str]
    prerequisites: Optional[str]
    corequisites: Optional[str]
    antirequisites: Optional[str]
    lists: List[str]                 # lists / terms where this course is referenced (e.g., "1B Term", "List 1")
    source_url: str
    json_captured: bool              # whether any Kuali JSON captured for this course (informational)

@dataclass
class ProgramResult:
    program_url: str
    title: Optional[str]
    description: Optional[str]
    required_by_term: Dict[str, List[Dict[str, str]]] # e.g., "1A": [{"code": "CS 137", "title": "Programming Principles"}]
    course_lists: Dict[str, List[Dict[str, str]]] # e.g., "Electives": [{"code": "MATH 100", "title": "Math for Dummies"}]
    elective_requirements_by_term: Dict[str, Dict[str, Any]] # e.g., "3A": {"count": 1, "description": "approved elective"}
    source_url: str
    json_captured: bool # informational, if any program JSON was captured

# ---- DOM scraping utilities (run in the page) ------------------------------

DOM_JS_COLLECT_LINKS = """
(() => {
  // Return all course links with their nearest headings context.
  const anchors = Array.from(document.querySelectorAll('a[href*="#/courses/view/"]'));
  const isHeading = (el) => !!el && /^(H1|H2|H3|H4|H5|H6)$/i.test(el.tagName);

  function nearestHeadings(el) {
    // Walk up the DOM looking for the closest preceding Hn (local) and the nearest higher-level section heading above it.
    // We'll collect up to two: localHeading (closest Hn above), and sectionHeading (a higher Hn before that).
    let local = null;
    let section = null;

    // climb to a block container so we can look backwards
    let node = el;
    while (node && node.previousElementSibling == null) node = node.parentElement;

    // Search backwards for a heading; if none on this level, climb and continue
    function findPrevHeading(start) {
      let n = start;
      while (n) {
        // scan previous siblings
        let p = n.previousElementSibling;
        while (p) {
          if (isHeading(p)) return p;
          // also check if this sibling contains headings somewhere inside (e.g., lists wrapped in sections)
          const h = p.querySelector && p.querySelector('h1,h2,h3,h4,h5,h6');
          if (h) return h;
          p = p.previousElementSibling;
        }
        // climb
        n = n.parentElement;
      }
      return null;
    }

    const first = findPrevHeading(el);
    if (first) {
      local = first.textContent.trim();
      // find an earlier higher heading (by going before `first`)
      const container = first.parentElement;
      if (container) {
        const beforeFirst = findPrevHeading(container);
        if (beforeFirst) section = beforeFirst.textContent.trim();
      }
    }
    return { localHeading: local, sectionHeading: section };
  }

  return anchors.map(a => {
    const ctx = nearestHeadings(a);
    return {
      href: a.getAttribute('href') || '',
      text: (a.textContent || '').trim(),
      localHeading: ctx.localHeading || null,
      sectionHeading: ctx.sectionHeading || null,
    };
  });
})();
"""

DOM_JS_GET_MAIN_CONTENT_TEXT = """
(() => {
    const mainContentElement = document.body; 
    if (mainContentElement) {
        return mainContentElement.innerText;
    }
    return null;
})();
"""

# We are removing DOM_JS_READ_SECTION as its functionality will be handled in Python

DOM_JS_COLLECT_PROGRAM_REQUIREMENTS = r"""
(() => {
    const programData = {
        required_by_term: {},
        elective_requirements_by_term: {},
        course_lists: {}
    };

    const extractCoursesFromList = (listElement) => {
        const courses = [];
        const courseLinks = Array.from(listElement.querySelectorAll('li > span > a[href*="#/courses/view/"]'));
        for (const link of courseLinks) {
            const textContent = link.textContent.trim();
            const codeMatch = textContent.match(/([A-Z]{2,5})\\s*-?\\s*(\\d{2,3}[A-Z]?)/);
            if (codeMatch) {
                const fullCode = `${codeMatch[1]} ${codeMatch[2]}`.replace(/\\s+/g, ''); // Remove space for consistent code format
                let title = textContent.replace(codeMatch[0], '').trim();
                // Remove credits part if present, e.g., " - Programming Principles (0.50)" -> " - Programming Principles"
                title = title.replace(/\\s*\\([0-9.]+\\)/, '').replace(/^[\\s-–—]*/, '').trim();
                if (title === '' && link.parentNode) {
                    // Fallback to parent text if title is still empty, removing code and credits
                    const parentText = link.parentNode.textContent.trim();
                    title = parentText.replace(codeMatch[0], '').replace(/\\s*\\([0-9.]+\\)/, '').replace(/^[\\s-–—]*/, '').trim();
                }
                courses.push({
                    code: fullCode,
                    title: title || "Unknown Title" // Ensure title is never empty
                });
            } 
        }

        // Handle generic elective placeholders if no specific course links were found in this list
        const genericElectiveItems = Array.from(listElement.querySelectorAll('li'));
        for (const item of genericElectiveItems) {
            if (item.textContent.includes('approved elective') && !item.querySelector('a[href*="#/courses/view/"]')) {
                const electiveText = item.textContent.trim();
                const numElectivesMatch = electiveText.match(/Complete (?:a total of )?(\\d+) approved electives?/);
                if (numElectivesMatch) {
                    const num = parseInt(numElectivesMatch[1]);
                    for (let i = 0; i < num; i++) {
                        courses.push({
                            code: `ELECTIVE_GENERIC_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                            title: `Approved Elective ${i + 1}`
                        });
                    }
                } else if (electiveText.includes('approved elective')) {
                    courses.push({
                        code: `ELECTIVE_GENERIC_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                        title: `Approved Elective`
                    });
                }
            }
        }

        return courses;
    };

    // Extract term-based requirements
    const courseRequirementsSection = document.querySelector('h3.program-view__label___RGRDq');

    if (courseRequirementsSection && courseRequirementsSection.textContent.includes('Course Requirements')) {
        const rulesWrapper = courseRequirementsSection.closest('.noBreak').querySelector('.rules-wrapper');
        if (rulesWrapper) {
            const termSections = Array.from(rulesWrapper.querySelectorAll('section'));
            for (const section of termSections) {
                const headerSpan = section.querySelector('.style__itemHeaderH2___2f-ov > span');
                if (headerSpan) {
                    const termName = headerSpan.textContent.trim();
                    if (termName.match(/^[1-4][AB] Term$/)) {
                        // Look for ul directly under div[data-test="ruleView-A-result"] or div[data-test="ruleView-C-result"]
                        const courseListUlA = section.querySelector('div[data-test="ruleView-A-result"] > div > ul');
                        const courseListUlC = section.querySelector('div[data-test="ruleView-C-result"] > div > ul');
                        
                        let courseListElement = null;
                        if (courseListUlA) {
                            courseListElement = courseListUlA;
                        } else if (courseListUlC) {
                            courseListElement = courseListUlC;
                        }

                        if (courseListElement) {
                            programData.required_by_term[termName] = [...(programData.required_by_term[termName] || []), ...extractCoursesFromList(courseListElement)];
                        }

                         // Also check for electives directly under ruleView-B
                        const electiveDivB = section.querySelector('div[data-test="ruleView-B-result"]');
                        if (electiveDivB) {
                            const electives = extractCoursesFromList(electiveDivB);
                            if (electives.length > 0) {
                                programData.required_by_term[termName] = [...(programData.required_by_term[termName] || []), ...electives];
                            }
                        }
                        
                        // Extract elective requirements (e.g., "Complete 1 approved elective")
                        try {
                            const allTextInSection = section.innerText || section.textContent || '';
                            const electivePatterns = [
                                /Complete\s+(\d+)\s+approved\s+electives?/i,
                                /complete\s+(\d+)\s+approved\s+electives?/i
                            ];
                            for (const pattern of electivePatterns) {
                                const match = allTextInSection.match(pattern);
                                if (match) {
                                    const count = parseInt(match[1], 10);
                                    const termKey = termName.replace(' Term', '').trim();
                                    if (termKey && !isNaN(count) && count > 0) {
                                        programData.elective_requirements_by_term[termKey] = {
                                            count: count,
                                            description: 'approved elective'
                                        };
                                        break;
                                    }
                                }
                            }
                        } catch (e) {
                            // Silently ignore errors in elective extraction to not break main flow
                        }
                    }
                }
            }
        }
    }

    // Extract general course lists (electives, etc.)
    const courseListsSection = Array.from(document.querySelectorAll('h3.program-view__label___RGRDq')).find(h3 => h3.textContent.includes('Course Lists'));
    if (courseListsSection) {
        const rulesWrapper = courseListsSection.closest('.noBreak').querySelector('.rules-wrapper');
        if (rulesWrapper) {
            const topLevelSections = Array.from(rulesWrapper.querySelectorAll('section'));
            for (const topSection of topLevelSections) {
                const topHeaderSpan = topSection.querySelector('.style__itemHeaderH2___2f-ov > span');
                if (topHeaderSpan) {
                    const listName = topHeaderSpan.textContent.trim();
                    if (listName !== '') {
                        // Check for direct course lists under this section (like Undergraduate Communication Requirement)
                        const directCourseList = topSection.querySelector('div[data-test="ruleView-A-result"] > div > ul, div[data-test="ruleView-B-result"] > div > ul');
                        if (directCourseList) {
                             programData.course_lists[listName] = [...(programData.course_lists[listName] || []), ...extractCoursesFromList(directCourseList)];
                        }

                        // Check for nested sections (like List 1, List 2 under Technical Electives List)
                        const nestedSections = Array.from(topSection.querySelectorAll('section'));
                        for (const nestedSection of nestedSections) {
                            const nestedHeaderSpan = nestedSection.querySelector('.style__itemHeaderH2___2f-ov > span');
                            if (nestedHeaderSpan) {
                                const nestedListName = nestedHeaderSpan.textContent.trim();
                                if (nestedListName !== '') {
                                    const nestedCourseList = nestedSection.querySelector('div[data-test="ruleView-A-result"] > div > ul, div[data-test="ruleView-B-result"] > div > ul');
                                    if (nestedCourseList) {
                                        programData.course_lists[nestedListName] = [...(programData.course_lists[nestedListName] || []), ...extractCoursesFromList(nestedCourseList)];
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return programData;
})();
"""

DOM_JS_READ_UNITS = r"""
() => {
  // Units often appear as a small "Units" block or within a nearby section.
  // Try to find an element labeled "Units" then grab the next text.
  const labels = Array.from(document.querySelectorAll('h1,h2,h3,dt,strong,span'));
  let units = null;

  function grabNextText(node) {
    // Find closest following text-y node
    let n = node.nextElementSibling;
    while (n) {
      const t = (n.innerText || n.textContent || '').trim();
      if (t) return t;
      n = n.nextElementSibling;
    }
    return null;
  }

  for (const el of labels) {
    const txt = (el.textContent || '').trim().toLowerCase();
    if (txt === "units") {
      units = grabNextText(el);
      if (units) break;
    }
  }
  if (!units) {
    // fallback: scan for a line like "Units\n0.50"
    const all = (document.body.innerText || '').split('\n').map(s => s.trim());
    for (let i = 0; i < all.length - 1; i++) {
      if (all[i].toLowerCase() === 'units' && all[i+1]) return all[i+1];
    }
  }
  return units;
}
"""

DOM_JS_READ_HEADER = r"""
() => {
  // Return top page header (often "<CODE> - <Title>")
  const h = document.querySelector('h1, h2');
  return h ? (h.innerText || h.textContent || '').trim() : null;
}
"""

# ---- Core scraping ----------------------------------------------------------

async def accept_cookies_if_present(page):
    # Click buttons that look like cookie acceptors
    try:
        btn = await page.get_by_role("button", name=re.compile(r"accept|agree", re.I)).first
        if await btn.is_visible(timeout=2000):
            await btn.click()
    except Exception:
        pass
    # Some sites use different markup
    try:
        await page.locator("text=Accept all").first.click(timeout=1500)
    except Exception:
        pass

async def wait_for_spa(page, *, heavy: bool = False):
    # Wait for the React app to settle; 'networkidle' helps SPA fetches.
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=15000)
    except Exception:
        pass
    # Give the router time
    try:
        await page.wait_for_load_state("networkidle", timeout=15000 if heavy else 8000)
    except Exception:
        pass

async def collect_program_courses(page) -> Tuple[List[Tuple[str, str]], Dict[str, Set[str]]]:
    """
    Returns:
      - course_refs: list of (course_id, course_url)
      - membership: mapping "CS 241" -> set(["1B Term", "List 1", ...])
    """
    # ensure content visible
    await wait_for_spa(page, heavy=True)

    # sometimes the app lazy-renders on scroll; scroll a bit
    for _ in range(3):
        await page.mouse.wheel(0, 1200)
        await asyncio.sleep(0.3)

    links = await page.evaluate(DOM_JS_COLLECT_LINKS)
    membership: Dict[str, Set[str]] = {}
    course_refs: List[Tuple[str, str]] = []

    for li in links:
        href = li.get("href") or ""
        text = li.get("text") or ""
        if COURSE_LINK_HREF_PART not in href:
            continue
        # Hash route -> absolute url for convenience
        url = "https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog" + href
        cid = href.split("/view/")[-1].strip()
        code = normalize_code(text) or normalize_code(li.get("localHeading") or "") or None

        # Infer list/term name from nearest headings
        local = (li.get("localHeading") or "").strip()
        section = (li.get("sectionHeading") or "").strip()
        bucket_candidates = [local, section]
        bucket = next((b for b in bucket_candidates if b), None)

        if code:
            membership.setdefault(code, set())
            if bucket:
                # simplify bucket names like "Complete all of the following" -> ignore
                if not re.search(r"complete|following|choose|must|minimum|units?|credits?", bucket, re.I):
                    membership[code].add(bucket.strip())

        course_refs.append((cid, url))

    # dedupe preserving order
    course_refs = list(uniq(course_refs))
    return course_refs, membership

async def scrape_program_details(page, program_url: str, json_seen_flag: Dict[str, bool], debug_html_out: Optional[Path] = None) -> ProgramResult:
    await page.goto(program_url, wait_until="domcontentloaded")
    await wait_for_spa(page, heavy=True)

    # Capture outerHTML of the main content area after SPA has rendered
    html_content = await page.evaluate("document.querySelector('main#kuali-catalog-main')?.outerHTML || document.body.outerHTML")
    
    if debug_html_out: # Save raw HTML for debugging if requested
        debug_html_out.write_text(html_content, encoding="utf-8")
        print(f"Saved program HTML to {debug_html_out}")

    # Get the correct program title from the breadcrumb
    title_el = await page.locator("span.style__current___S6hvB").first.inner_text()
    title = clean_text(title_el)

    description_el = await read_section_text(page, "Description") # This will return None
    description = clean_text(description_el)

    # Get the structured program requirements directly
    program_structured_data = await page.evaluate(DOM_JS_COLLECT_PROGRAM_REQUIREMENTS)

    # Create result with HTML included for fallback parsing
    result = ProgramResult(
        program_url=program_url,
        title=title,
        description=description,
        required_by_term=program_structured_data.get("required_by_term", {}),
        course_lists=program_structured_data.get("course_lists", {}),
        elective_requirements_by_term=program_structured_data.get("elective_requirements_by_term", {}),
        source_url=program_url,
        json_captured=bool(json_seen_flag.get(program_url, False)),
    )
    
    # Attach raw HTML to result object for later serialization
    result.raw_program_html = html_content
    
    return result

async def read_section_text(page, title: str) -> Optional[str]:
    # This function is no longer needed as we are getting raw text and parsing in Python
    # Re-enabling for description, but it will likely return None since text is not extracted like this anymore.
        return None

async def read_units(page) -> Optional[str]:
    try:
        return clean_text(await page.evaluate(DOM_JS_READ_UNITS))
    except Exception:
        return None

async def read_header(page) -> Tuple[Optional[str], Optional[str]]:
    try:
        header = await page.evaluate(DOM_JS_READ_HEADER)
    except Exception:
        header = None
    header = header or ""
    code = normalize_code(header)
    title = None
    if code:
        # title likely after " - "
        parts = header.split(" - ", 1)
        if len(parts) == 2:
            title = clean_text(parts[1])
        else:
            # fallback: remove code from start
            title = clean_text(header.replace(code, "", 1).lstrip(" -–—"))
    else:
        # try grabbing a second-level heading for title if present
        try:
            h2 = await page.locator("h2").first.inner_text()
            title = clean_text(h2)
        except Exception:
            pass
    return code, title

async def open_course_page(page, url: str):
    await page.goto(url, wait_until="domcontentloaded")
    await wait_for_spa(page, heavy=True)
    # Ensure course heading is present
    try:
        await page.get_by_role("heading", name=re.compile(r"[A-Z]{2,5}\s*\d{2,3}")).wait_for(timeout=8000)
    except Exception:
        pass

async def scrape_course(page, cid: str, url: str, buckets_for_course: Set[str], json_seen_flag: Dict[str, bool], json_data_by_course_id: Dict[str, Dict[str, Any]]) -> CourseResult:
    await open_course_page(page, url)

    code, title = await read_header(page)
    units = await read_units(page)
    description = await read_section_text(page, "Description")
    prerequisites = await read_section_text(page, "Prerequisites")
    corequisites = await read_section_text(page, "Corequisites")
    antirequisites = await read_section_text(page, "Antirequisites")
    
    # Try to extract units from JSON if DOM extraction failed
    if not units and cid in json_data_by_course_id:
        try:
            json_data = json_data_by_course_id[cid]
            data = json_data.get("data") or json_data
            attributes = data.get("attributes") or data
            credits = attributes.get("credits") or attributes.get("units")
            if isinstance(credits, dict):
                units = str(credits.get("min") or credits.get("max") or "")
            elif credits:
                units = str(credits)
        except Exception:
            pass

    return CourseResult(
        course_id=cid,
        code=code,
        title=title,
        units=units,
        description=description,
        prerequisites=prerequisites,
        corequisites=corequisites,
        antirequisites=antirequisites,
        lists=sorted(list(buckets_for_course)) if buckets_for_course else [],
        source_url=url,
        json_captured=bool(json_seen_flag.get(cid, False)),
    )

# ---- Main -------------------------------------------------------------------

async def run(program_url: str, out_path: Path, headful: bool, max_courses: Optional[int], debug_html_out: Optional[Path]):
    t0 = time.time()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # We'll stream results as we go so Ctrl-C preserves work
    out_f = out_path.open("a", encoding="utf-8")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not headful)
        context = await browser.new_context()
        page = await context.new_page()

        # JSON capture (informational). We attach BEFORE any navigation.
        # We'll map url -> True if we saw any JSON for it, and store JSON data for course extraction
        json_seen_for_url: Dict[str, bool] = {}
        json_data_by_course_id: Dict[str, Dict[str, Any]] = {}  # course_id -> JSON data

        def looks_like_json(ctype: Optional[str], url: str) -> bool:
            ct = (ctype or "").lower()
            return ("json" in ct) or url.endswith(".json") or "kuali.co/api" in url

        async def on_response(resp):
            try:
                url = resp.url
                # We care mostly about the Kuali catalog endpoints
                if ("uwaterloocm.kuali.co/api" not in url) and ("/api/v1/catalog" not in url):
                    return
                ctype = resp.headers.get("content-type", "")
                if looks_like_json(ctype, url):
                    txt = await resp.text()
                    t = txt.strip()
                    if not t:
                        return
                    if t[0] in "{" and t[-1] == "}": # Check for JSON object
                        json_seen_for_url[url] = True
                        # Try to extract course data from JSON
                        try:
                            data = json.loads(txt)
                            # Extract course ID from URL or JSON
                            course_id_match = re.search(r"courses/view/([a-f0-9]+)", url)
                            if not course_id_match:
                                # Try to find course ID in JSON
                                if isinstance(data, dict):
                                    course_id = data.get("data", {}).get("id") or data.get("id")
                                    if course_id:
                                        json_data_by_course_id[course_id] = data
                            else:
                                course_id = course_id_match.group(1)
                                json_data_by_course_id[course_id] = data
                        except Exception:
                            pass
            except Exception:
                pass

        context.on("response", on_response)

        # Go to program page and scrape program details first
        program_details = await scrape_program_details(page, program_url, json_seen_for_url, debug_html_out) # Pass debug_html_out
        # Write program details to the JSONL file (include raw HTML for fallback parsing)
        program_dict = asdict(program_details)
        if hasattr(program_details, 'raw_program_html') and program_details.raw_program_html:
            program_dict['raw_program_html'] = program_details.raw_program_html
        out_f.write(json.dumps(program_dict, ensure_ascii=False) + "\n")
        out_f.flush()
        print(f"Scraped program details for: {program_details.title}")

        # Collect all course links & buckets from program page
        # We need to re-navigate to the program_url after scraping details, as scrape_program_details might have changed the page.
        await page.goto(program_url, wait_until="domcontentloaded")
        await accept_cookies_if_present(page)
        await wait_for_spa(page, heavy=True)

        course_refs, membership = await collect_program_courses(page)

        if max_courses:
            course_refs = course_refs[:max_courses]

        total = len(course_refs)
        print(f"Found {total} course links on program page.")
        # Build quick lookup: code -> set(buckets)
        buckets_by_code = membership  # already that

        # Visit each course and scrape details
        for i, (cid, url) in enumerate(course_refs, start=1):
            # Map buckets for this course by code (if we can resolve)
            # We try to pre-guess the code from the url text (unknown here),
            # but we'll update once the page loads and we know the exact code.
            buckets = set()

            try:
                result = await scrape_course(page, cid, url, buckets, json_seen_for_url, json_data_by_course_id)

                # If we now have a code, merge any buckets we learned from the program page
                if result.code and result.code in buckets_by_code:
                    result.lists = sorted(list(set(result.lists) | buckets_by_code[result.code]))

                # Log line
                print(f"[{i}/{total}] {result.code or cid} — JSON:{result.json_captured}")

                # Stream to file as JSONL
                out_f.write(json.dumps(asdict(result), ensure_ascii=False) + "\n")
                out_f.flush()

            except KeyboardInterrupt:
                print("\nInterrupted by user. Partial results saved.")
                break
            except Exception as e:
                print(f"[{i}/{total}] ERROR {cid}: {e}")
                # still write a minimal record so we keep progress
                minimal = CourseResult(
                    course_id=cid,
                    code=None, title=None, units=None, description=None,
                    prerequisites=None, corequisites=None, antirequisites=None,
                    lists=sorted(list(buckets)), source_url=url, json_captured=bool(json_seen_for_url.get(cid, False))
                )
                out_f.write(json.dumps(asdict(minimal), ensure_ascii=False) + "\n")
                out_f.flush()

        await context.close()
        await browser.close()
        out_f.close()

    dt = time.time() - t0
    print(f"Done in {dt:.1f}s. Output → {out_path}")

def main():
    import argparse
    p = argparse.ArgumentParser(description="Scrape UW SE program courses + course details into JSONL.")
    p.add_argument("--program-url", default=PROGRAM_URL, help="Program page URL (SE default).")
    p.add_argument("--out", default="se_courses.jsonl", help="Output JSONL path.")
    p.add_argument("--headful", action="store_true", help="Run headed (helpful to watch).")
    p.add_argument("--max-courses", type=int, default=None, help="Limit number of courses (debug).")
    # p.add_argument("--debug-html-out", type=Path, default=None, help="Output path for raw HTML content (debug).") # Commented out new argument
    args = p.parse_args()

    # asyncio.run(run(args.program_url, Path(args.out), args.headful, args.max_courses, args.debug_html_out))
    asyncio.run(run(args.program_url, Path(args.out), args.headful, args.max_courses, None)) # Pass None for debug_html_out

if __name__ == "__main__":
    main()
