"""Assessment pipeline — the closed loop described in the document's
"full assessment submit endpoint". Consumed by the API and by seed.py
(for the demo student's synthetic history).

process_responses():
  1. classify every wrong answer (cognitive error classifier)
  2. estimate global IRT theta over all items
  3. per concept: BKT update, multi-factor mastery, Ebbinghaus decay
  4. regenerate (versioned) roadmap with prerequisite interception
"""

import json
import uuid
from datetime import datetime, timezone

from engines.bkt import BayesianKnowledgeTracing
from engines.error_classifier import classify_error
from engines.forgetting import ForgettingModel
from engines.graph import CurriculumGraph, PrerequisiteResolver
from engines.irt import ItemResponseTheory
from engines.mastery import compute_mastery
from engines.priority import PriorityEngine
from engines.roadmap import RoadmapGenerator
from models import (
    AssessmentAttempt,
    Question,
    Roadmap,
    RoadmapAction,
    Student,
    StudentAttemptItem,
    StudentConceptMastery,
)


def _load_questions(db):
    return {q.question_id: q for q in db.query(Question).all()}


def _update_concept(db, student_id, concept_id, as_of=None):
    """BKT + mastery + forgetting for one concept, then persist."""
    now = as_of or datetime.now(timezone.utc)

    items = (
        db.query(StudentAttemptItem)
        .filter_by(student_id=student_id, concept_id=concept_id)
        .order_by(StudentAttemptItem.timestamp, StudentAttemptItem.id)
        .all()
    )

    response_sequence = [bool(i.is_correct) for i in items]
    bkt = BayesianKnowledgeTracing()
    bkt_mastery = bkt.compute_sequence_mastery(response_sequence)

    attempts = [
        {
            "is_correct": bool(i.is_correct),
            "difficulty": i.difficulty,
            "time_taken_seconds": i.time_taken_seconds,
        }
        for i in items
    ]
    mastery_result = compute_mastery(attempts)

    rec = (
        db.query(StudentConceptMastery)
        .filter_by(student_id=student_id, concept_id=concept_id)
        .first()
    )
    previous_last_practiced = rec.last_practiced_at if rec else None
    review_count = rec.review_count if rec else 0

    fm = ForgettingModel()
    decay = fm.calculate_retention(
        mastery_result["mastery"],
        previous_last_practiced,
        review_count=review_count,
        now=now,
    )

    if rec is None:
        rec = StudentConceptMastery(student_id=student_id, concept_id=concept_id)
        db.add(rec)

    rec.mastery = decay["effective_mastery"]
    rec.bkt_mastery = bkt_mastery
    rec.confidence = mastery_result["confidence"]
    rec.forgetting_risk = decay["forgetting_risk"]
    rec.attempts_count = len(items)
    rec.correct_count = sum(1 for i in items if i.is_correct)
    rec.last_practiced_at = now
    rec.review_count = review_count + 1
    rec.updated_at = now

    return {
        "concept_id": concept_id,
        "mastery": decay["effective_mastery"],
        "bkt_mastery": bkt_mastery,
        "forgetting_risk": decay["forgetting_risk"],
        "confidence": mastery_result["confidence"],
        "retention_score": decay["retention_score"],
        "days_since_practice": decay["days_since_practice"],
    }


def refresh_forgetting_risk(db, student_id, now=None):
    """Recompute every concept's forgetting risk against the current date,
    so a concept practised two weeks ago (and never touched since) shows its
    real decay on the dashboard, not just at the next quiz submit."""
    now = now or datetime.now(timezone.utc)
    fm = ForgettingModel()
    changed = False
    for rec in db.query(StudentConceptMastery).filter_by(student_id=student_id).all():
        if rec.last_practiced_at is None or rec.mastery <= 0:
            continue
        decay = fm.calculate_retention(
            rec.mastery,
            rec.last_practiced_at,
            review_count=max(rec.review_count - 1, 0),
            now=now,
        )
        if abs(decay["forgetting_risk"] - rec.forgetting_risk) > 0.001:
            rec.forgetting_risk = decay["forgetting_risk"]
            changed = True
    if changed:
        db.commit()


def _generate_roadmap(db, student_id, trigger="QUIZ_SUBMIT"):
    graph = CurriculumGraph(db)
    resolver = PrerequisiteResolver(db, graph)
    priority = PriorityEngine(db, graph, resolver)
    generator = RoadmapGenerator(db, priority, resolver, graph)

    # supersede previous active roadmap
    for old in db.query(Roadmap).filter_by(student_id=student_id, status="ACTIVE").all():
        old.status = "SUPERSEDED"

    prev = (
        db.query(Roadmap).filter_by(student_id=student_id).order_by(Roadmap.version.desc()).first()
    )
    version = (prev.version + 1) if prev else 1
    roadmap = Roadmap(
        roadmap_id=f"rm_{uuid.uuid4().hex[:10]}",
        student_id=student_id,
        version=version,
        status="ACTIVE",
        trigger_event=trigger,
    )
    db.add(roadmap)
    db.flush()

    actions = generator.generate_roadmap(student_id)
    for a in actions:
        db.add(
            RoadmapAction(
                roadmap_id=roadmap.roadmap_id,
                sequence_order=a["sequence_order"],
                action_type=a.get("action_type", "REVIEW"),
                concept_id=a["concept_id"],
                priority_score=a["priority_score"],
                reasons=json.dumps(a["reasons"]),
                target_questions_count=a.get("questions_count", 5),
                estimated_minutes=a.get("estimated_minutes", 30),
                target_difficulty=a.get("target_difficulty", 0.5),
            )
        )
    return roadmap, actions


def process_responses(db, student_id, responses, attempt_id=None, as_of=None):
    """responses: list of {question_id, student_answer, time_taken_seconds}."""
    questions = _load_questions(db)
    now = as_of or datetime.now(timezone.utc)

    attempt_id = attempt_id or f"at_{uuid.uuid4().hex[:10]}"
    attempt = AssessmentAttempt(
        attempt_id=attempt_id,
        student_id=student_id,
        test_tier="PRACTICE",
        created_at=now,
    )
    db.add(attempt)

    irt_tuples = []
    item_results = []
    for r in responses:
        q = questions.get(r["question_id"])
        if q is None:
            continue
        is_correct = bool(r.get("student_answer") and r["student_answer"] == q.correct_answer)
        est = q.estimated_time_seconds or 60
        err = classify_error(
            json.loads(q.distractor_explanations or "{}"),
            r.get("student_answer"),
            q.correct_answer,
            int(r.get("time_taken_seconds", 0)),
            estimated_time_seconds=est,
        )
        item_results.append(
            {
                "question_id": q.question_id,
                "concept_id": q.concept_id,
                "question_text": q.question_text,
                "student_answer": r.get("student_answer"),
                "correct_answer": q.correct_answer,
                "is_correct": is_correct,
                "error_type": err["error_type"],
                "note": err["note"],
            }
        )
        db.add(
            StudentAttemptItem(
                attempt_id=attempt.attempt_id,
                student_id=student_id,
                question_id=q.question_id,
                concept_id=q.concept_id,
                student_answer=r.get("student_answer"),
                correct_answer=q.correct_answer,
                is_correct=is_correct,
                difficulty=q.difficulty,
                discrimination=q.discrimination,
                time_taken_seconds=int(r.get("time_taken_seconds", 0)),
                error_type=err["error_type"],
                distractor_note=err["note"],
                timestamp=now,
            )
        )
        irt_tuples.append((is_correct, q.difficulty, q.discrimination))

    db.flush()  # items are queryable by the mastery update below

    theta = ItemResponseTheory.estimate_student_ability(irt_tuples)
    attempt.irt_theta_estimated = theta

    student = db.query(Student).filter_by(student_id=student_id).first()
    if student:
        student.irt_ability = theta

    concept_ids = []
    for r in responses:
        q = questions.get(r["question_id"])
        if q and q.concept_id not in concept_ids:
            concept_ids.append(q.concept_id)

    updates = []
    for concept_id in concept_ids:
        updates.append(_update_concept(db, student_id, concept_id, as_of=now))

    # copy the global theta onto touched concept records for transparency
    for u in updates:
        rec = (
            db.query(StudentConceptMastery)
            .filter_by(student_id=student_id, concept_id=u["concept_id"])
            .first()
        )
        if rec:
            rec.irt_ability = theta

    correct_count = sum(1 for r in responses if r.get("student_answer")
                        and questions.get(r["question_id"])
                        and r["student_answer"] == questions[r["question_id"]].correct_answer)
    total = len(responses)
    attempt.score_percentage = round(100.0 * correct_count / total, 1) if total else 0.0

    roadmap, actions = _generate_roadmap(db, student_id)

    db.commit()

    return {
        "attempt_id": attempt.attempt_id,
        "score_percentage": attempt.score_percentage,
        "total_questions": total,
        "correct_count": correct_count,
        "irt_theta": theta,
        "roadmap_id": roadmap.roadmap_id,
        "roadmap_version": roadmap.version,
        "concept_mastery_updates": updates,
        "roadmap_actions": actions,
        "item_results": item_results,
    }