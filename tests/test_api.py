"""API integration tests — full five-engine loop through FastAPI's TestClient.

POST /api/students
  -> GET  /api/students/{id}/dashboard   (onboarding roadmap w/ gap interception)
  -> GET  /api/students/{id}/quiz/{concept}
  -> POST /api/assessments/submit        (IRT + BKT + mastery + forgetting + rebuild)
  -> GET  dashboard again                (state actually persisted)
plus curriculum/mastery endpoints and the static SPA.
"""

import uuid

from database import SessionLocal
from models import Question

LETTERS = "ABCD"


def _create_student(client, name=None):
    name = name or f"Student {uuid.uuid4().hex[:6]}"
    r = client.post("/api/students", json={"name": name, "target_exam": "Boards"})
    assert r.status_code == 201, r.text
    return r.json()["student_id"]


def _correct_answers(question_ids):
    db = SessionLocal()
    try:
        rows = db.query(Question).filter(Question.question_id.in_(question_ids)).all()
        return {q.question_id: q.correct_answer for q in rows}
    finally:
        db.close()


def _build_responses(questions, alternator):
    """Answer each question: on even index pick the correct letter, else a
    plausible wrong letter (the first that differs from the correct one)."""
    correct = _correct_answers([q["question_id"] for q in questions])
    out = []
    for i, q in enumerate(questions):
        want_correct = alternator(i)
        letter = correct[q["question_id"]] if want_correct else next(
            c for c in LETTERS if c != correct[q["question_id"]]
        )
        out.append(
            {
                "question_id": q["question_id"],
                "student_answer": letter,
                "time_taken_seconds": 45,
            }
        )
    return out


# ---------------------------------------------------------------------------


def test_onboarding_roadmap_intercepts_root_gap(client):
    sid = _create_student(client)

    d = client.get(f"/api/students/{sid}/dashboard").json()
    assert d["student"]["student_id"] == sid
    assert d["stats"]["total_concepts"] == 16

    actions = d["roadmap"]["actions"]
    assert len(actions) >= 1
    # Fresh student has zero mastery everywhere, so the engine must notice the
    # broken root prerequisites (c01 Scalars, c04 First Law) and force them to
    # the very front of the plan before any advanced target concept.
    first = actions[0]
    assert first["concept_id"] in {"c01", "c04"}
    assert first["action_type"] == "FOUNDATION_REBUILD"
    assert first["priority_score"] == 0.95
    assert any("Root foundational gap" in r for r in first["reasons"])
    assert {a["concept_id"] for a in actions[:2]} == {"c01", "c04"}
    # sequence numbers are contiguous from 1
    assert [a["sequence_order"] for a in actions] == list(
        range(1, len(actions) + 1)
    )
    assert d["roadmap"]["version"] == 1


def test_full_quiz_submit_flow_rebuilds_roadmap(client):
    sid = _create_student(client)
    dash = client.get(f"/api/students/{sid}/dashboard").json()
    action = dash["roadmap"]["actions"][0]
    concept_id = action["concept_id"]
    count = action["target_questions_count"]
    difficulty = action["target_difficulty"]

    quiz = client.get(
        f"/api/students/{sid}/quiz/{concept_id}?count={count}&difficulty={difficulty}"
    )
    assert quiz.status_code == 200, quiz.text
    q = quiz.json()
    assert q["concept_id"] == concept_id
    questions = q["questions"]
    n = len(questions)
    assert 1 <= n <= count  # question bank may be smaller than requested
    for question in questions:
        assert len(question["options"]) == 4
        assert question["estimated_time_seconds"] > 0

    # alternating correct/wrong starting with a correct answer
    responses = _build_responses(questions, alternator=lambda i: i % 2 == 0)
    r = client.post(
        "/api/assessments/submit",
        json={"student_id": sid, "responses": responses},
    )
    assert r.status_code == 200, r.text
    body = r.json()

    expected_correct = sum(1 for i in range(n) if i % 2 == 0)
    assert body["score_percentage"] == round(100.0 * expected_correct / n, 1)
    assert body["total_questions"] == n
    assert body["correct_count"] == expected_correct
    assert body["roadmap_version"] == 2
    assert -3.0 <= body["irt_theta"] <= 3.0

    # the concept touched must now carry real mastery numbers
    assert len(body["concept_mastery_updates"]) == 1
    update = body["concept_mastery_updates"][0]
    assert update["concept_id"] == concept_id
    assert update["mastery"] > 0
    assert update["bkt_mastery"] > 0.2
    assert 0.0 <= update["forgetting_risk"] <= 1.0

    # wrong answers get classified with a reason
    wrong_items = [it for it in body["item_results"] if not it["is_correct"]]
    assert len(wrong_items) == n - expected_correct
    for it in wrong_items:
        assert it["error_type"] is not None
        assert it["note"]

    # dashboard now reflects persisted state + the new roadmap version
    dash2 = client.get(f"/api/students/{sid}/dashboard").json()
    assert dash2["roadmap"]["version"] == 2
    row = next(c for c in dash2["mastery"]["concepts"] if c["concept_id"] == concept_id)
    assert row["attempts_count"] == n
    assert row["mastery"] > 0
    assert dash2["stats"]["attempts"] == n


def test_curriculum_exposes_graph(client):
    cur = client.get("/api/curriculum").json()
    assert len(cur["concepts"]) == 16
    assert len(cur["edges"]) == 20
    for c in cur["concepts"]:
        assert 0.0 <= c["prerequisite_impact"] <= 1.0
    # edges always point at real concepts
    ids = {c["concept_id"] for c in cur["concepts"]}
    for e in cur["edges"]:
        assert e["from"] in ids and e["to"] in ids


def test_mastery_heatmap_endpoint(client):
    sid = _create_student(client)
    m = client.get(f"/api/students/{sid}/mastery").json()
    assert len(m["concepts"]) == 16
    assert m["mastered_count"] == 0  # untouched student
    assert all(c["attempts_count"] == 0 for c in m["concepts"])


def test_static_spa_is_served(client):
    spa = client.get("/app")
    assert spa.status_code == 200
    assert "MasteryOS" in spa.text

    js = client.get("/static/js/app.js")
    assert js.status_code == 200
    assert "renderDashboard" in js.text

    css = client.get("/static/css/styles.css")
    assert css.status_code == 200


def test_error_handling(client):
    # unknown student -> 404 on dashboard / mastery / quiz
    assert client.get("/api/students/ghost/dashboard").status_code == 404
    assert client.get("/api/students/ghost/mastery").status_code == 404
    assert client.get("/api/students/ghost/quiz/c01").status_code == 404

    sid = _create_student(client)
    # unknown concept -> 404
    assert client.get(f"/api/students/{sid}/quiz/nope").status_code == 404

    # submit with no responses -> 422
    r = client.post("/api/assessments/submit", json={"student_id": sid, "responses": []})
    assert r.status_code == 422

    # duplicate student name -> 409
    r = client.post("/api/students", json={"name": "Duplicated Name"})
    assert r.status_code == 201
    r = client.post("/api/students", json={"name": "Duplicated Name"})
    assert r.status_code == 409
