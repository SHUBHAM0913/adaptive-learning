"""hf_import.py — bulk-load questions from the 169Pi/exambench Hugging Face
dataset into the adaptive-learning question bank.

exambench rows are free-response (prompt / complex_cot / response), while the
platform quizzes students with 4-option MCQs, so each row is handed to an
LLM that (a) tags the question with the closest seeded concept (or rejects it
as outside the curriculum) and (b) turns it into an MCQ with tagged distractor
explanations. Rows that fail conversion or fall outside the curriculum are
counted and skipped — nothing is half-inserted.

The LLM endpoint is OpenAI-compatible and configurable via env vars
(LLM_BASE_URL, LLM_API_KEY, LLM_MODEL). Defaults point at a local Ollama:

    ollama pull llama3
    python hf_import.py --limit 10 --dry-run     # preview only, nothing written
    python hf_import.py --limit 10               # convert + insert
    python hf_import.py --limit 100 --llm-batch 5

To use a hosted endpoint instead (e.g. the Alpie API):

    LLM_BASE_URL=https://api.169pi.ai/v1 LLM_API_KEY=sk-... \\
        LLM_MODEL=alpie-core python hf_import.py --limit 50

The database is the same one the server uses (override with ADAPTIVE_DB),
and the concepts must already be seeded — run `python seed.py` once first.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from question_bank import QuestionCreate, TAXONOMY_TAGS, add_questions, normalize_item

HUGGINGFACE_ROWS_API = "https://datasets-server.huggingface.co/first-rows"

# Long chain-of-thought fields are truncated before being sent to the LLM to
# keep prompt size (and cost) bounded.
FIELD_CAP = 1200


# --------------------------------------------------------------------------
# Data fetching (datasets-server REST API — no `datasets` dependency)
# --------------------------------------------------------------------------


def fetch_rows(dataset: str, split: str, offset: int, length: int) -> list[dict]:
    """Fetch up to `length` rows starting at `offset`. Public datasets need no
    token. Raises RuntimeError on API-level errors."""
    params = urllib.parse.urlencode(
        {"dataset": dataset, "config": "default", "split": split,
         "offset": offset, "length": length}
    )
    url = f"{HUGGINGFACE_ROWS_API}?{params}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if "error" in payload:
        raise RuntimeError(f"datasets-server error: {payload['error']}")
    return [entry["row"] for entry in payload.get("rows", []) if "row" in entry]


# --------------------------------------------------------------------------
# LLM glue (OpenAI-compatible /chat/completions)
# --------------------------------------------------------------------------


def chat(base_url: str, api_key: str, model: str,
         system: str, user: str, timeout: int = 120) -> str:
    """One chat-completion call; returns the assistant message text."""
    body = json.dumps(
        {
            "model": model,
            "temperature": 0.0,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
    ).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    url = base_url.rstrip("/")
    if not url.endswith("/chat/completions"):
        url += "/chat/completions"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"LLM HTTP {exc.code}: {detail}") from exc
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        raise RuntimeError(f"Unexpected LLM response shape: {str(data)[:300]}") from exc


def extract_json_array(text: str) -> list:
    """Robustly pull a JSON array out of model output (which may wrap it in
    markdown fences or prose)."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    start = cleaned.find("[")
    if start == -1:
        raise ValueError("LLM returned no JSON array")
    decoder = json.JSONDecoder()
    try:
        obj, _ = decoder.raw_decode(cleaned[start:])
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM returned invalid JSON: {exc}") from exc
    if not isinstance(obj, list):
        raise ValueError("LLM JSON is not an array")
    return obj


def _ellipsize(value: str, cap: int = FIELD_CAP) -> str:
    value = (value or "").strip()
    return value if len(value) <= cap else value[:cap] + " …[truncated]"


def conversion_system_prompt(concepts: list[dict]) -> str:
    """`concepts` = [{"concept_id": "c01", "name": ..., "topic_id": ...}]"""
    listing = "\n".join(
        f'- {c["concept_id"]} — {c["name"]} (topic: {c.get("topic_id", "")})'
        for c in concepts
    )
    tags = ", ".join(TAXONOMY_TAGS)
    return (
        "You convert real competitive-exam questions into multiple-choice questions (MCQs) "
        "for an adaptive physics-learning platform. The platform only knows the concepts "
        f"listed below:\n{listing}\n\n"
        "For each numbered exam question you receive, decide whether it maps to ONE of "
        "those concepts. If it does not (wrong subject, no overlap), answer with "
        '{"index": i, "concept_id": null}. Otherwise produce exactly this JSON object:\n'
        '{\n'
        '  "index": <the input number>,\n'
        '  "concept_id": "<the closest concept_id from the list>",\n'
        '  "question_text": "<clear MCQ stem, rewritten as a standalone question>",\n'
        '  "options": ["<correct-or-wrong option A>", "<option B>", "<option C>", "<option D>"],\n'
        '  "correct_answer": "<letter A-D of the TRUE option, based strictly on the reference answer>",\n'
        '  "difficulty": <0.0 to 1.0, how hard the item is>, \n'
        '  "estimated_time_seconds": <integer, typical solving time 30-120>,\n'
        '  "distractor_explanations": {"<wrong letter>": "<TAG>: <why a student choosing this is wrong>", ...}\n'
        "}\n"
        "Rules:\n"
        "- Return ONLY a JSON array of these objects — no markdown, no prose.\n"
        "- All four options must be plausible; the correct one must match the reference answer.\n"
        "- Keep the stem self-contained; do not reference 'the text above'.\n"
        f"- Each distractor explanation must start with one of: {tags}.\n"
        "- If the item is a pure calculation, include numeric distractors.\n"
        "- Never invent facts absent from the question and reference answer."
    )


def conversion_user_prompt(items: list[dict]) -> str:
    """items: list of exambench rows already fetched (prompt/complex_cot/response)."""
    blocks = []
    for i, row in enumerate(items, start=1):
        blocks.append(
            f"QUESTION {i}\n"
            f"prompt: {_ellipsize(row.get('prompt', ''))}\n"
            f"reference response: {_ellipsize(row.get('response', ''))}\n"
            f"worked reasoning: {_ellipsize(row.get('complex_cot', ''))}"
        )
    return "\n\n".join(blocks)


def convert_exambench_rows(rows: list[dict], concepts: list[dict], *, chat_fn,
                           llm_batch: int = 3) -> list[dict]:
    """Convert exambench rows into per-row results. `chat_fn(system, user)`
    returns the LLM text; injectable for tests. Each result is either
    {"index", "status": "converted", "item": QuestionCreate} or
    {"index", "status": "skipped", "reason": "..."}.
    """
    results: list[dict] = []
    for start in range(0, len(rows), llm_batch):
        chunk = rows[start:start + llm_batch]
        system = conversion_system_prompt(concepts)
        user = conversion_user_prompt(chunk)
        try:
            answers = extract_json_array(chat_fn(system, user))
        except Exception as exc:  # noqa: BLE001 — any LLM hiccup skips the chunk
            for k in range(len(chunk)):
                results.append(
                    {"index": start + k, "status": "skipped",
                     "reason": f"LLM call failed: {exc}"}
                )
            continue
        if not isinstance(answers, list):
            for k in range(len(chunk)):
                results.append(
                    {"index": start + k, "status": "skipped",
                     "reason": "LLM did not return an array"}
                )
            continue
        by_index = {}
        for a in answers:
            if isinstance(a, dict) and "index" in a:
                by_index[a["index"]] = a
        for k, row in enumerate(chunk):
            raw = by_index.get(k + 1)
            if not isinstance(raw, dict):
                results.append(
                    {"index": start + k, "status": "skipped",
                     "reason": "missing/blank entry in LLM output"}
                )
                continue
            if raw.get("concept_id") in (None, "", "null"):
                results.append(
                    {"index": start + k, "status": "skipped",
                     "reason": "outside curriculum (no matching concept)"}
                )
                continue
            try:
                item = QuestionCreate(
                    question_id=raw.get("question_id"),
                    concept_id=str(raw["concept_id"]).strip(),
                    question_text=raw["question_text"],
                    options=list(raw["options"]),
                    correct_answer=raw.get("correct_answer", ""),
                    difficulty=float(raw.get("difficulty", 0.5)),
                    estimated_time_seconds=int(raw.get("estimated_time_seconds", 60)),
                    distractor_explanations=raw.get("distractor_explanations") or {},
                )
                normalize_item(item)  # surface shape errors now
            except Exception as exc:  # noqa: BLE001 — report, do not crash
                results.append(
                    {"index": start + k, "status": "skipped",
                     "reason": f"invalid MCQ payload: {exc}"}
                )
                continue
            results.append({"index": start + k, "status": "converted", "item": item})
    return results


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------


def run_import(rows: list[dict], *, chat_fn, llm_batch: int = 3,
               replace: bool = False, dry_run: bool = False, db=None) -> dict:
    """Full pipeline used by the CLI (and by tests with a fake chat_fn)."""
    from database import SessionLocal
    from models import Concept

    own_session = db is None
    db = db or SessionLocal()
    try:
        concepts = db.query(Concept).order_by(Concept.concept_id).all()
        if not concepts:
            return {"error": "No concepts found — run `python seed.py` first."}
        concept_list = [
            {"concept_id": c.concept_id, "name": c.name, "topic_id": c.topic_id}
            for c in concepts
        ]
        converted = convert_exambench_rows(rows, concept_list, chat_fn=chat_fn,
                                           llm_batch=llm_batch)
        items = [r["item"] for r in converted if r["status"] == "converted"]
        stats = {
            "rows_fetched": len(rows),
            "converted": len(items),
            "out_of_curriculum": sum(
                1 for r in converted if "curriculum" in r.get("reason", "")
            ),
            "conversion_errors": sum(
                1 for r in converted if r["status"] == "skipped"
                and "curriculum" not in r.get("reason", "")
            ),
            "dry_run": dry_run,
        }
        if dry_run or not items:
            return stats
        out = add_questions(db, items, replace=replace)
        stats.update(
            {
                "inserted": out["inserted"],
                "updated": out["updated"],
                "skipped_duplicates": out["skipped"],
                "insert_errors": out["errors"],
            }
        )
        return stats
    finally:
        if own_session:
            db.close()


def _env_or_flag(value, env_name: str, default):
    if value is not None:
        return value
    return os.environ.get(env_name, default)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Import MCQs converted from the 169Pi/exambench HF dataset.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--dataset", default="169Pi/exambench",
                        help="Hugging Face dataset to read rows from")
    parser.add_argument("--split", default="train")
    parser.add_argument("--limit", type=int, default=3,
                        help="max rows to process; 0 = stream until the dataset ends")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--llm-batch", type=int, default=3, dest="llm_batch",
                        help="exambench rows converted per LLM call")
    parser.add_argument("--replace", action="store_true",
                        help="overwrite existing question_ids instead of skipping")
    parser.add_argument("--dry-run", action="store_true",
                        help="convert and report, but write nothing to the DB")
    parser.add_argument("--base-url", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--api-key", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--model", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    base_url = _env_or_flag(args.base_url, "LLM_BASE_URL", "http://localhost:11434/v1")
    api_key = _env_or_flag(args.api_key, "LLM_API_KEY", "")
    model = _env_or_flag(args.model, "LLM_MODEL", "llama3")

    def chat_fn(system: str, user: str) -> str:
        return chat(base_url, api_key, model, system, user)

    print(f"Fetching rows from {args.dataset} ({args.split}) …")
    rows: list[dict] = []
    limit_left = args.limit if args.limit > 0 else None
    offset = args.offset
    while limit_left is None or len(rows) < limit_left:
        want = min(100, limit_left - len(rows)) if limit_left else 100
        try:
            page = fetch_rows(args.dataset, args.split, offset, want)
        except Exception as exc:  # noqa: BLE001
            print(f"Aborting: {exc}", file=sys.stderr)
            break
        if not page:
            break
        rows.extend(page)
        offset += len(page)
        if len(page) < want:
            break
        time.sleep(0.2)  # be gentle with the datasets-server rate limits

    if not rows:
        print("No rows fetched — is the dataset/name right?")
        return 1

    stats = run_import(rows, chat_fn=chat_fn, llm_batch=args.llm_batch,
                       replace=args.replace, dry_run=args.dry_run)
    if "error" in stats:
        print(stats["error"], file=sys.stderr)
        return 2
    print(json.dumps(stats, indent=2))
    print(
        "Verify with: GET /api/questions  (or run the server and open /api/docs)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
