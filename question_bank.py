"""Question-bank ingestion helpers — shared by the API routes (main.py) and
the Hugging Face exambench importer (hf_import.py).

Canonicalizes incoming MCQs into the exact shape the ``questions`` table
expects: ``options`` = a JSON list of 4 strings, ``correct_answer`` = the
option LETTER (A-D), ``distractor_explanations`` = JSON dict mapping each
wrong option LETTER to a "TAG: explanation" string (see TAXONOMY_TAGS).
"""

import json
import re
import uuid

from pydantic import BaseModel, Field, field_validator

from models import Question

LETTERS = "ABCD"

# Tags the error classifier understands — importer prompts tell the LLM to
# prefix every distractor explanation with one of these.
TAXONOMY_TAGS = [
    "CONCEPTUAL_ERROR",
    "FORMULA_SELECTION_ERROR",
    "CALCULATION_ERROR",
    "SIGN_ERROR",
    "UNIT_ERROR",
    "READING_ERROR",
    "CARELESS_ERROR",
]


class QuestionCreate(BaseModel):
    """One incoming MCQ. `correct_answer` accepts a LETTER ("B") or an index
    (1) so LLM output is easy to feed in; it is normalized to a letter."""

    question_id: str | None = None
    concept_id: str
    question_text: str
    options: list[str]
    correct_answer: str | int
    difficulty: float = Field(0.5, ge=0.0, le=1.0)
    discrimination: float = Field(1.0, gt=0.0)
    estimated_time_seconds: int = Field(60, ge=1)
    distractor_explanations: dict[str, str] = Field(default_factory=dict)

    @field_validator("options")
    @classmethod
    def _four_distinct_options(cls, v: list[str]) -> list[str]:
        cleaned = [o.strip() for o in v]
        if len(cleaned) != 4:
            raise ValueError("exactly 4 options are required")
        if any(not o for o in cleaned):
            raise ValueError("options must not be blank")
        if len(set(cleaned)) != 4:
            raise ValueError("options must be distinct")
        return cleaned

    @field_validator("question_text")
    @classmethod
    def _question_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("question_text must not be blank")
        return v.strip()


def normalize_correct_answer(value: str | int) -> str:
    """Accept 'B', 'b', 'Option B', '(b)' or an index 0-3; return 'A'..'D'."""
    if isinstance(value, int):
        if 0 <= value <= 3:
            return LETTERS[value]
        raise ValueError("correct_answer index must be 0-3")
    match = re.search(r"[ABCD]", str(value).upper())
    if match:
        return match.group(0)
    raise ValueError("correct_answer must be a letter A-D")


def normalize_item(item: QuestionCreate) -> QuestionCreate:
    """Resolve the correct-answer letter and tidy distractor notes so the row
    matches the seeded question format. Raises ValueError on bad input."""
    correct = normalize_correct_answer(item.correct_answer)
    distractors = {}
    for key, note in (item.distractor_explanations or {}).items():
        letter = normalize_correct_answer(key) if re.fullmatch(r"[A-Da-d]", key.strip()) else None
        if letter is None:
            continue
        text = note.strip()
        if text and letter != correct:
            distractors[letter] = text
    return item.model_copy(
        update={
            "correct_answer": correct,
            "distractor_explanations": distractors,
        }
    )


def add_questions(db, items: list[QuestionCreate], replace: bool = False) -> dict:
    """Insert (or update) questions in one transaction.

    Duplicates are skipped by default; pass ``replace=True`` to overwrite an
    existing question_id instead. Returns a summary plus a per-item result
    list whose entries align with the input order:
    {"status": "inserted" | "updated" | "skipped" | "error", ...}
    """
    from models import Concept

    known_concepts = {c.concept_id for c in db.query(Concept).all()}

    results = []
    inserted = updated = skipped = 0
    for index, item in enumerate(items):
        try:
            norm = normalize_item(item)
        except ValueError as exc:
            results.append({"index": index, "status": "error", "error": str(exc)})
            continue
        if norm.concept_id not in known_concepts:
            results.append(
                {
                    "index": index,
                    "status": "error",
                    "error": f"Unknown concept_id '{norm.concept_id}'",
                }
            )
            continue
        question_id = norm.question_id or f"q_{uuid.uuid4().hex[:10]}"
        existing = db.query(Question).filter_by(question_id=question_id).first()
        if existing is not None:
            if not replace:
                skipped += 1
                results.append(
                    {
                        "index": index,
                        "question_id": question_id,
                        "status": "skipped",
                        "reason": "duplicate",
                    }
                )
                continue
            existing.concept_id = norm.concept_id
            existing.question_text = norm.question_text
            existing.options = json.dumps(norm.options)
            existing.correct_answer = norm.correct_answer
            existing.difficulty = norm.difficulty
            existing.discrimination = norm.discrimination
            existing.estimated_time_seconds = norm.estimated_time_seconds
            existing.distractor_explanations = json.dumps(norm.distractor_explanations)
            updated += 1
            results.append(
                {"index": index, "question_id": question_id, "status": "updated"}
            )
            continue
        db.add(
            Question(
                question_id=question_id,
                concept_id=norm.concept_id,
                question_text=norm.question_text,
                options=json.dumps(norm.options),
                correct_answer=norm.correct_answer,
                difficulty=norm.difficulty,
                discrimination=norm.discrimination,
                estimated_time_seconds=norm.estimated_time_seconds,
                distractor_explanations=json.dumps(norm.distractor_explanations),
            )
        )
        inserted += 1
        results.append(
            {"index": index, "question_id": question_id, "status": "inserted"}
        )

    db.commit()
    return {
        "total": len(items),
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "errors": sum(1 for r in results if r["status"] == "error"),
        "results": results,
    }
