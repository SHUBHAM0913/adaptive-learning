"""Question-bank ingestion tests.

Covers the admin ingest API (POST /api/questions, POST /api/questions/batch,
GET /api/questions) and the Hugging Face exambench importer (hf_import.py),
including the LLM-conversion path with a fake chat function.

Every row written uses a ``testq_`` question_id prefix and is removed at
teardown so later test files (which assert on the seeded bank, e.g. exactly
4 questions for concept c01) still see the pristine seeded DB.
"""

import json
import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def cleanup_questions():
    """Delete every question whose id starts with 'testq_' after the test."""
    yield
    from database import SessionLocal
    from models import Question

    db = SessionLocal()
    try:
        db.query(Question).filter(Question.question_id.like("testq_%")).delete(
            synchronize_session=False
        )
        db.commit()
    finally:
        db.close()


def _payload(**overrides):
    base = {
        "concept_id": "c02",
        "question_text": "A car accelerates from rest at 2 m/s² for 5 s. How far does it travel?",
        "options": ["25 m", "10 m", "50 m", "2.5 m"],
        "correct_answer": "A",
        "difficulty": 0.5,
        "estimated_time_seconds": 60,
        "distractor_explanations": {
            "B": "CALCULATION_ERROR: 2×5 doubles instead of ½at².",
            "C": "CALCULATION_ERROR: 2×5² ignores the ½ factor.",
            "D": "CALCULATION_ERROR: the formula is inverted.",
        },
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Single-question endpoint
# ---------------------------------------------------------------------------


def test_add_single_question_roundtrip(client, cleanup_questions):
    body = _payload(question_id="testq_single_01", concept_id="c02")
    r = client.post("/api/questions", json=body)
    assert r.status_code == 201, r.text
    saved = r.json()
    assert saved["question_id"] == "testq_single_01"
    assert saved["correct_answer"] == "A"
    assert saved["options"] == body["options"]
    assert saved["distractor_explanations"]["B"].startswith("CALCULATION_ERROR")

    listed = client.get("/api/questions").json()
    ids = [q["question_id"] for q in listed["questions"]]
    assert "testq_single_01" in ids


def test_add_question_auto_id_and_index_answer(client, cleanup_questions):
    # no question_id -> server generates one; correct_answer as an index (1) -> "B"
    r = client.post("/api/questions", json=_payload(question_id=None, correct_answer=1))
    assert r.status_code == 201, r.text
    saved = r.json()
    assert saved["question_id"].startswith("q_")
    assert saved["correct_answer"] == "B"


def test_add_question_validation_errors(client):
    # wrong number of options
    bad = _payload(options=["only one", "two"])
    assert client.post("/api/questions", json=bad).status_code == 422

    # blank stem
    assert client.post("/api/questions", json=_payload(question_text="  ")).status_code == 422

    # nonsense correct answer
    assert client.post("/api/questions", json=_payload(correct_answer="Q")).status_code == 422

    # duplicate id -> 409
    body = _payload(question_id="q01_01")  # already seeded
    assert client.post("/api/questions", json=body).status_code == 409

    # unknown concept -> 422
    r = client.post("/api/questions", json=_payload(concept_id="c99"))
    assert r.status_code == 422
    assert "Unknown concept" in r.json()["detail"]


def test_list_questions_by_concept(client):
    r = client.get("/api/questions?concept_id=c01")
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 4
    assert all(q["concept_id"] == "c01" for q in data["questions"])

    assert client.get("/api/questions?concept_id=nope").status_code == 404


# ---------------------------------------------------------------------------
# Batch endpoint
# ---------------------------------------------------------------------------


def test_batch_partial_success(client, cleanup_questions):
    body = {
        "questions": [
            _payload(question_id="testq_batch_01", concept_id="c02"),
            _payload(question_id="testq_batch_02", concept_id="c03",
                     question_text="What is momentum?",
                     options=["mass × velocity", "mass + velocity", "mass / velocity",
                              "velocity / mass"],
                     correct_answer="A",
                     distractor_explanations={
                         "B": "CONCEPTUAL_ERROR: adding unlike quantities.",
                         "C": "CONCEPTUAL_ERROR: division is not momentum.",
                         "D": "FORMULA_SELECTION_ERROR: inverted ratio.",
                     }),
            _payload(question_id="testq_batch_03", concept_id="does_not_exist"),
            _payload(question_id="q01_01"),  # seeded duplicate -> skipped
        ]
    }
    r = client.post("/api/questions/batch", json=body)
    assert r.status_code == 200, r.text
    summary = r.json()
    assert summary["inserted"] == 2
    assert summary["skipped"] == 1
    assert summary["errors"] == 1
    by_status = {res["status"]: res for res in summary["results"]}
    assert by_status["skipped"]["question_id"] == "q01_01"
    assert "Unknown concept" in by_status["error"]["error"]


def test_batch_replace_updates_existing(client, cleanup_questions):
    # insert once, then replace with replace=true
    first = _payload(question_id="testq_replace_01", concept_id="c02",
                     question_text="original text")
    assert client.post("/api/questions", json=first).status_code == 201

    changed = _payload(question_id="testq_replace_01", concept_id="c02",
                       question_text="updated text", correct_answer="C")
    r = client.post("/api/questions/batch",
                    json={"questions": [changed], "replace": True})
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 1

    listed = client.get("/api/questions").json()["questions"]
    saved = next(q for q in listed if q["question_id"] == "testq_replace_01")
    assert saved["question_text"] == "updated text"
    assert saved["correct_answer"] == "C"

    # replace=false (default) would skip instead
    r = client.post("/api/questions/batch", json={"questions": [changed]})
    assert r.json()["skipped"] == 1


# ---------------------------------------------------------------------------
# hf_import conversion (fake LLM)
# ---------------------------------------------------------------------------


PHYSICS_ROW = {
    "prompt": "Two vectors of 3 N and 4 N act at right angles. Find the resultant.",
    "complex_cot": "Use Pythagoras: sqrt(3^2+4^2)=5.",
    "response": "5 N",
}

CHEM_ROW = {
    "prompt": "Explain the structure of phosphine.",
    "complex_cot": "PH3, trigonal pyramidal.",
    "response": "Phosphine is PH3.",
}


def _fake_chat_returning(payload_text):
    def chat_fn(system, user):
        return payload_text
    return chat_fn


def test_extract_json_array_handles_fences_and_prose():
    from hf_import import extract_json_array

    assert extract_json_array('```json\n[{"a": 1}]\n```') == [{"a": 1}]
    assert extract_json_array('Sure! Here is the output:\n[{"a": 1}, {"b": 2}] hope that helps') == [
        {"a": 1},
        {"b": 2},
    ]
    with pytest.raises(ValueError):
        extract_json_array("no array here")


def test_convert_exambench_rows_classifies_and_skips():
    from hf_import import convert_exambench_rows

    answers = [
        {
            "index": 1,
            "concept_id": "c02",
            "question_text": "Two vectors of 3 N and 4 N act at right angles. "
                             "What is the magnitude of the resultant?",
            "options": ["7 N", "5 N", "1 N", "12 N"],
            "correct_answer": "B",
            "difficulty": 0.55,
            "estimated_time_seconds": 60,
            "distractor_explanations": {
                "A": "CONCEPTUAL_ERROR: adding path magnitudes ignores direction.",
                "C": "SIGN_ERROR: 4−3 subtracts the perpendicular legs.",
                "D": "CALCULATION_ERROR: 3×4 multiplies the legs.",
            },
        },
        {"index": 2, "concept_id": None},  # chemistry -> outside curriculum
    ]
    fake = _fake_chat_returning(json.dumps(answers))
    results = convert_exambench_rows(
        [PHYSICS_ROW, CHEM_ROW],
        [{"concept_id": "c02", "name": "Distance, Displacement, Speed, Velocity",
          "topic_id": "Kinematics"}],
        chat_fn=fake,
    )
    assert results[0]["status"] == "converted"
    assert results[0]["item"].correct_answer == "B"
    assert results[1]["status"] == "skipped"
    assert "curriculum" in results[1]["reason"]


def test_convert_exambench_rows_bad_llm_payload_reported():
    from hf_import import convert_exambench_rows

    bad = [
        {
            "index": 1,
            "concept_id": "c02",
            "question_text": "Broken MCQ",
            "options": ["only three options"],  # not 4 -> invalid payload
            "correct_answer": "A",
        }
    ]
    fake = _fake_chat_returning(json.dumps(bad))
    results = convert_exambench_rows(
        [PHYSICS_ROW],
        [{"concept_id": "c02", "name": "Kinematics", "topic_id": "Kinematics"}],
        chat_fn=fake,
    )
    assert results[0]["status"] == "skipped"
    assert "invalid MCQ payload" in results[0]["reason"]


def test_convert_exambench_rows_llm_error_skips_chunk():
    from hf_import import convert_exambench_rows

    def boom(system, user):
        raise RuntimeError("connection refused")

    results = convert_exambench_rows(
        [PHYSICS_ROW, CHEM_ROW],
        [{"concept_id": "c02", "name": "Kinematics", "topic_id": "Kinematics"}],
        chat_fn=boom,
    )
    assert len(results) == 2
    assert all(r["status"] == "skipped" for r in results)
    assert "connection refused" in results[0]["reason"]


def test_run_import_inserts_converted_rows(client, cleanup_questions):
    from database import SessionLocal
    from hf_import import run_import

    answer = {
        "index": 1,
        "question_id": "testq_hf_import_01",
        "concept_id": "c02",
        "question_text": "Two vectors of 3 N and 4 N act at right angles. "
                         "What is the magnitude of the resultant?",
        "options": ["7 N", "5 N", "1 N", "12 N"],
        "correct_answer": "B",
        "difficulty": 0.55,
        "estimated_time_seconds": 60,
        "distractor_explanations": {
            "A": "CONCEPTUAL_ERROR: adding magnitudes ignores direction.",
            "C": "SIGN_ERROR: 4−3 subtracts the perpendicular legs.",
            "D": "CALCULATION_ERROR: 3×4 multiplies the legs.",
        },
    }
    fake = _fake_chat_returning(json.dumps([answer]))
    db = SessionLocal()
    try:
        stats = run_import([PHYSICS_ROW], chat_fn=fake, db=db)
    finally:
        db.close()
    assert stats["rows_fetched"] == 1
    assert stats["converted"] == 1
    assert stats["inserted"] == 1

    # the question is queryable through the API
    listed = client.get("/api/questions?concept_id=c02").json()["questions"]
    matching = [q for q in listed if "3 N and 4 N" in q["question_text"]]
    assert len(matching) == 1
    assert matching[0]["correct_answer"] == "B"
