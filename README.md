# course-connect

Simplify the process of looking through uWaterloo courses.

## Data pipeline (Kuali + UW Open Data + UWFlow)

The course graph the front-end reads is built from three **structured** UW data
sources, joined by course code — no scraping of rendered HTML pages. Coverage is
the full undergraduate catalog (all subjects), not just Software Engineering.

| Source | Module | What it provides |
| --- | --- | --- |
| **UW Kuali catalog** (`uwaterloocm.kuali.co`) | `Scraper/kuali_catalog.py` | Structured courses: units/credits, level, subject, description, and boolean **prerequisite / antirequisite / corequisite** trees. |
| **UW Open Data API v3** (`openapi.data.uwaterloo.ca`) | `Scraper/uw_opendata_api.py` | **Live seat counts** (enrolled / capacity) for the current term. Requires an API key; skipped gracefully if absent. |
| **UWFlow** (`uwflow.com/graphql`) | `Scraper/uwflow_api.py` | Ratings (liked / easy / useful) and human-readable prereq/antireq prose. |

### Setup

```bash
pip install -r Scraper/requirements.txt

# Optional: enable live seat counts from UW Open Data
cp .env.example .env
# then edit .env and set UW_OPENDATA_KEY (get a free key at
# https://openapi.data.uwaterloo.ca/). Load it into your shell before running:
export $(grep -v '^#' .env | xargs)
```

`UW_OPENDATA_KEY` is read from the environment and is **never** hardcoded. If it
is unset the pipeline still runs and simply omits the seat fields.

### Run the full refresh

```bash
# Everything, all subjects:
python Processing/build_dataset.py

# Faster subset while iterating:
python Processing/build_dataset.py --subjects CS MATH SE --limit 100
```

This regenerates, matching the exact shapes the front-end already consumes
(see `app/src/context/AppDataContext.tsx`):

- `data/nodes.json` — `{id, code, title, credits, description, subject, level, uwflow_*?, seats_*?}`
- `data/edges.json` — `{source, target, type (PREREQ|COREQ|ANTIREQ), logic (ANY), group_id}`
- `data/constraints.json` — `{target, kind, expr}` for non-course requirements (program / standing / high-school)
- `courses.jsonl` — one combined record per course (superset of all three sources, incl. the raw requirement trees)

Prerequisite logic is emitted in conjunctive normal form: each `group_id` is one
"AND" clause whose members are alternatives (`logic: ANY`). A single-member group
is effectively a mandatory prerequisite. This is what
`app/src/utils/prerequisites.ts` expects.

> **Deploy note:** the dev/prod front-end serves its data from
> `app/public/data/`. Copy the regenerated files there as part of a deploy
> (`cp data/*.json app/public/data/`). The pipeline writes to `data/` so it never
> touches the `app/` tree.

### Individual modules

Each source module can also be run on its own for debugging:

```bash
python Scraper/kuali_catalog.py --subjects CS --out kuali_cs.jsonl
python Scraper/uw_opendata_api.py --out seats.json      # needs UW_OPENDATA_KEY
python Scraper/uwflow_api.py CS241 MATH237               # single-course lookups
```
