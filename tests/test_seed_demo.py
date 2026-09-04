"""End-to-end check of the demo-student seeding path.

seed(create_demo=True) replays 13 synthetic practice sessions through the full
pipeline (error classify -> IRT -> BKT -> mastery -> roadmap rebuild) with
backdated timestamps — exactly the run that produced the live dashboard the
frontend's "Explore the demo student" button shows.
"""


def test_seed_demo_student_produces_live_dashboard(client):
    from seed import seed

    # Curriculum is already seeded by conftest; this adds the demo student.
    seed(create_demo=True)

    d = client.get("/api/students/demo/dashboard").json()
    assert d["student"]["student_id"] == "demo"
    assert 0.0 <= d["student"]["irt_ability"] <= 3.0  # mostly-correct history

    assert d["stats"]["total_concepts"] == 16
    assert d["stats"]["attempts"] == 59
    assert d["stats"]["mastered_count"] >= 8

    # each of the 13 practised concepts rebuilt the roadmap once
    assert d["roadmap"]["version"] == 13
    actions = d["roadmap"]["actions"]
    assert len(actions) >= 6
    # the broken root prerequisite is intercepted and forced to the front
    first = actions[0]
    assert first["concept_id"] in {"c01", "c04"}
    assert first["priority_score"] == 0.95
    assert any("Root foundational gap" in r for r in first["reasons"])

    # concepts left untouched have no history; stale ones show forgetting risk
    mastery = {c["concept_id"]: c for c in d["mastery"]["concepts"]}
    assert mastery["c12"]["attempts_count"] == 0
    assert mastery["c14"]["attempts_count"] == 0
    assert mastery["c16"]["attempts_count"] == 0
    assert len(d["mastery"]["forgetting_alerts"]) >= 1

    # the demo student can take a real quiz through the same endpoints
    quiz = client.get("/api/students/demo/quiz/c01?count=5&difficulty=0.5")
    assert quiz.status_code == 200
    assert len(quiz.json()["questions"]) == 4
