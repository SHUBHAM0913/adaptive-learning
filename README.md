# Adaptive Learning Platform (MasteryOS)

FastAPI backend + five-engine adaptive learning system from the
*Adaptive Cognitive Modeling Engine* blueprint, with a no-build vanilla-JS
frontend. Every answer a student gives is scored with:

1. **Multi-Factor Mastery** — composite score from accuracy, difficulty weighting, recent trend, consistency, speed
2. **BKT** — hidden knowledge probability P(L), correcting lucky guesses and slips
3. **IRT 3PL** — latent ability θ estimated by Newton–Raphson
4. **Ebbinghaus Forgetting** — mastery decays over time; spaced-repetition alerts
5. **Prerequisite DAG** — root-cause gap detection; broken foundations get forced to the front of the study plan

## Quick start

```bash
# 1. install (one time)
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt

# 2. seed curriculum + question bank + demo student (idempotent)
.venv/Scripts/python.exe seed.py

# 3. run the server
.venv/Scripts/python.exe -m uvicorn main:app --port 8000
```

Open http://127.0.0.1:8000/app — click **Explore the demo student's dashboard**
or create your own student.

> Running `python main.py` from a foreground terminal can look "hung" — that is
> just uvicorn blocking the shell (the app is serving). Run it detached (step 3)
> or use the tests below, which need no server at all.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/students` | create a student (+ onboarding roadmap) |
| `GET /api/students/{id}/dashboard` | stats, roadmap, mastery overview |
| `GET /api/students/{id}/quiz/{concept}` | questions for a roadmap action |
| `POST /api/assessments/submit` | full pipeline: classify → IRT → BKT → mastery → roadmap rebuild |
| `GET /api/curriculum` | concepts + prerequisite edges (graph view) |
| `GET /api/students/{id}/mastery` | per-concept heatmap data |
| `/api/docs` | interactive OpenAPI docs |

## Tests

The suite runs the whole system **in-process via FastAPI's TestClient** against
a throwaway SQLite DB (`tests/test_adaptive.db`, auto-created/removed) — no
server, no port, nothing to hang:

```bash
.venv/Scripts/python.exe -m pytest -q
```

- `tests/test_engines.py` — unit tests for all five engines + error classifier
- `tests/test_api.py` — full API loop: create student → dashboard → quiz → submit → roadmap v2 → static SPA
- `tests/test_seed_demo.py` — replays the demo student's 13 synthetic sessions through the real pipeline

## Layout

```
engines/        five engines + error classifier + priority + roadmap
database.py     SQLite via SQLAlchemy (path overridable with ADAPTIVE_DB)
models.py       ORM schema (mirrors the blueprint's tables)
seed.py         curriculum seed + demo-student history
pipeline.py     the closed loop behind POST /api/assessments/submit
main.py         FastAPI app + static SPA mount
static/         MasteryOS frontend (index.html, css, js — no build step)
```
