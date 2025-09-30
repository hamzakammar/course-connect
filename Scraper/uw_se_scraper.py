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
from typing import Dict, List, Optional, Set, Tuple

from playwright.async_api import async_playwright

PROGRAM_URL = "https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/H1zle10Cs3"
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

DOM_JS_READ_SECTION = r"""
(sectionTitle) => {
  // Returns all text within the section whose heading text matches sectionTitle (case-insensitive, substring ok)
  const head = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .find(h => (h.textContent || '').toLowerCase().includes(sectionTitle.toLowerCase()));
  if (!head) return null;

  // gather siblings until the next heading of same or higher level
  const level = parseInt(head.tagName.slice(1), 10);
  let n = head.nextElementSibling;
  let texts = [];
  const pushText = (el) => {
    const t = el.innerText || el.textContent || '';
    if (t) texts.push(t);
  };
  while (n) {
    if (/^H[1-6]$/i.test(n.tagName)) {
      const lv = parseInt(n.tagName.slice(1), 10);
      if (lv <= level) break;
    }
    pushText(n);
    n = n.nextElementSibling;
  }
  return texts.join("\n").trim();
}
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

async def read_section_text(page, title: str) -> Optional[str]:
    try:
        txt = await page.evaluate(DOM_JS_READ_SECTION, title)
        return clean_text(txt)
    except Exception:
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

async def scrape_course(page, cid: str, url: str, buckets_for_course: Set[str], json_seen_flag: Dict[str, bool]) -> CourseResult:
    await open_course_page(page, url)

    code, title = await read_header(page)
    units = await read_units(page)
    description = await read_section_text(page, "Description")
    prerequisites = await read_section_text(page, "Prerequisites")
    corequisites = await read_section_text(page, "Corequisites")
    antirequisites = await read_section_text(page, "Antirequisites")

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

async def run(program_url: str, out_path: Path, headful: bool, max_courses: Optional[int]):
    t0 = time.time()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # We'll stream results as we go so Ctrl-C preserves work
    out_f = out_path.open("a", encoding="utf-8")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not headful)
        context = await browser.new_context()
        page = await context.new_page()

        # JSON capture (informational). We attach BEFORE any navigation.
        # We'll map course-id -> True if we saw any JSON from Kuali for it.
        json_seen_for_course: Dict[str, bool] = {}

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
                    if t[0] in "{[" and t[-1] in "}]":
                        # Mark any /courses/view/<id> or .../courses/<id>
                        m = re.search(r'/courses/(view/)?([a-f0-9]{24})', url)
                        if m:
                            cid = m.group(2)
                            json_seen_for_course[cid] = True
            except Exception:
                pass

        context.on("response", on_response)

        # Go to program page
        await page.goto(program_url, wait_until="domcontentloaded")
        await accept_cookies_if_present(page)
        await wait_for_spa(page, heavy=True)

        # Collect all course links & buckets from program page
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
                result = await scrape_course(page, cid, url, buckets, json_seen_for_course)

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
                    lists=sorted(list(buckets)), source_url=url, json_captured=bool(json_seen_for_course.get(cid, False))
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
    args = p.parse_args()

    asyncio.run(run(args.program_url, Path(args.out), args.headful, args.max_courses))

if __name__ == "__main__":
    main()
