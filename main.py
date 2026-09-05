"""Adaptive Learning Platform — FastAPI backend.

Endpoints:
  POST /api/students                  create a student
  GET  /api/students/{id}/dashboard   dashboard: roadmap + mastery overview
  GET  /api/students/{id}/quiz/{concept}   quiz for a roadmap action
  POST /api/assessments/submit        full five-engine assessment pipeline
  GET  /api/curriculum                concepts + prerequisite edges (graph view)
  GET  /api/students/{id}/mastery     heatmap data for every concept

Question-bank ingestion (bulk-load more questions from anywhere, e.g. the
169Pi/exambench Hugging Face dataset via hf_import.py):

  POST /api/questions                add one MCQ question
  POST /api/questions/batch          add many MCQs (duplicates skipped or replaced)
  GET  /api/questions                list the question bank (optionally by concept)
"""

import json
import random
import uuid

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import Base, engine, get_db
from engines.graph import CurriculumGraph, PrerequisiteResolver
from engines.priority import PriorityEngine
from engines.roadmap import RoadmapGenerator
from models import (
    Assignment,
    AttendanceRecord,
    Concept,
    Prerequisite,
    Question,
    Roadmap,
    RoadmapAction,
    Student,
    StudentConceptMastery,
    StudentAttemptItem,
    SubjectSchedule,
)
from pipeline import process_responses, refresh_forgetting_risk
import question_bank

# make sure new tables exist even if the DB was seeded before they were added
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Adaptive Learning Platform",
    description="Five-engine adaptive learning system: mastery, BKT, IRT, Ebbinghaus, prerequisite DAG.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------


class StudentCreate(BaseModel):
    name: str
    target_exam: str = "Boards"


class QuizResponse(BaseModel):
    question_id: str
    question_text: str
    options: list
    estimated_time_seconds: int


class ResponseItem(BaseModel):
    question_id: str
    student_answer: str = ""
    time_taken_seconds: int = 0


class AssessmentSubmit(BaseModel):
    student_id: str
    responses: list[ResponseItem]


class QuestionBatch(BaseModel):
    questions: list[question_bank.QuestionCreate]
    replace: bool = False  # overwrite existing question_ids instead of skipping


class AssignmentCreate(BaseModel):
    student_id: str
    title: str
    subject: str = "General"
    description: str = ""
    due_date: str | None = None  # YYYY-MM-DD


class AssignmentStatus(BaseModel):
    status: str  # open | done


class AttendanceMark(BaseModel):
    subject: str
    status: str = "PRESENT"  # PRESENT | ABSENT
    total_classes: int | None = None  # optionally re-plan the subject's total


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _question_payload(q: Question) -> dict:
    return {
        "question_id": q.question_id,
        "concept_id": q.concept_id,
        "question_text": q.question_text,
        "options": json.loads(q.options),
        "correct_answer": q.correct_answer,
        "difficulty": q.difficulty,
        "discrimination": q.discrimination,
        "estimated_time_seconds": q.estimated_time_seconds,
        "distractor_explanations": json.loads(q.distractor_explanations or "{}"),
    }


def _get_student_or_404(db, student_id: str) -> Student:
    student = db.query(Student).filter_by(student_id=student_id).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


def _active_roadmap(db, student_id: str):
    return (
        db.query(Roadmap)
        .filter_by(student_id=student_id, status="ACTIVE")
        .order_by(Roadmap.version.desc())
        .first()
    )


def _roadmap_payload(db, student_id: str) -> dict:
    roadmap = _active_roadmap(db, student_id)
    if roadmap is None:
        return {"roadmap_id": None, "version": None, "actions": []}
    actions = (
        db.query(RoadmapAction)
        .filter_by(roadmap_id=roadmap.roadmap_id)
        .order_by(RoadmapAction.sequence_order)
        .all()
    )
    mastery_by_concept = {
        r.concept_id: r
        for r in db.query(StudentConceptMastery).filter_by(student_id=student_id).all()
    }
    out = []
    for a in actions:
        concept = db.query(Concept).filter_by(concept_id=a.concept_id).first()
        rec = mastery_by_concept.get(a.concept_id)
        out.append(
            {
                "sequence_order": a.sequence_order,
                "action_type": a.action_type,
                "concept_id": a.concept_id,
                "concept_name": concept.name if concept else a.concept_id,
                "priority_score": a.priority_score,
                "reasons": json.loads(a.reasons or "[]"),
                "target_questions_count": a.target_questions_count,
                "estimated_minutes": a.estimated_minutes,
                "target_difficulty": a.target_difficulty,
                "mastery": round(rec.mastery, 3) if rec else 0.0,
                "confidence": round(rec.confidence, 3) if rec else 0.10,
            }
        )
    return {
        "roadmap_id": roadmap.roadmap_id,
        "version": roadmap.version,
        "trigger_event": roadmap.trigger_event,
        "actions": out,
    }


def _mastery_overview(db, student_id: str) -> dict:
    records = {
        r.concept_id: r
        for r in db.query(StudentConceptMastery).filter_by(student_id=student_id).all()
    }
    concepts = db.query(Concept).all()
    rows = []
    for c in concepts:
        r = records.get(c.concept_id)
        rows.append(
            {
                "concept_id": c.concept_id,
                "name": c.name,
                "topic_id": c.topic_id,
                "mastery": round((r.mastery if r else 0.0), 3),
                "confidence": round((r.confidence if r else 0.10), 3),
                "forgetting_risk": round((r.forgetting_risk if r else 0.0), 3),
                "attempts_count": (r.attempts_count if r else 0),
                "exam_relevance": c.exam_relevance,
                "difficulty_weight": c.difficulty_weight,
                "estimated_minutes": c.estimated_minutes,
            }
        )
    rows.sort(key=lambda x: x["concept_id"])
    mastered = sum(1 for r in rows if r["mastery"] >= 0.70)
    forgetting = [r for r in rows if r["forgetting_risk"] > 0.35 and r["attempts_count"] > 0]
    return {"concepts": rows, "mastered_count": mastered, "forgetting_alerts": forgetting}


def _subjects_overview(db, student_id: str) -> dict:
    """Group mastery rows by subject (topic_id) with per-subject aggregates."""
    overview = _mastery_overview(db, student_id)
    by_topic: dict[str, list] = {}
    for c in overview["concepts"]:
        by_topic.setdefault(c["topic_id"] or "General", []).append(c)

    subjects = []
    for topic, cs in sorted(by_topic.items()):
        mastered = sum(1 for c in cs if c["mastery"] >= 0.70)
        attempted = sum(1 for c in cs if c["attempts_count"] > 0)
        avg = sum(c["mastery"] for c in cs) / len(cs)
        minutes = sum((c["attempts_count"] / 5) * (c["estimated_minutes"] or 30) for c in cs)
        subjects.append(
            {
                "subject": topic,
                "concepts": cs,
                "concept_count": len(cs),
                "mastered_count": mastered,
                "attempted_count": attempted,
                "avg_mastery": round(avg, 3),
                "study_minutes": round(minutes),
                "forgetting_alerts": [
                    c for c in cs if c["forgetting_risk"] > 0.35 and c["attempts_count"] > 0
                ],
            }
        )
    subjects.sort(key=lambda s: s["avg_mastery"])  # weakest subject first
    return {"subjects": subjects}


def _assignment_payload(a: Assignment) -> dict:
    return {
        "assignment_id": a.assignment_id,
        "student_id": a.student_id,
        "title": a.title,
        "subject": a.subject,
        "description": a.description,
        "due_date": a.due_date,
        "status": a.status,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _attendance_summary(db, student_id: str) -> dict:
    schedules = {s.subject: s for s in db.query(SubjectSchedule).filter_by(student_id=student_id).all()}
    records = db.query(AttendanceRecord).filter_by(student_id=student_id).order_by(AttendanceRecord.class_number).all()

    by_subject: dict[str, dict] = {}
    for subj, s in schedules.items():
        by_subject[subj] = {
            "subject": subj,
            "total_classes": s.total_classes,
            "classes_done": s.classes_done,
            "present": 0,
            "absent": 0,
        }
    for r in records:
        row = by_subject.setdefault(
            r.subject,
            {"subject": r.subject, "total_classes": 12, "classes_done": 0, "present": 0, "absent": 0},
        )
        if r.status == "PRESENT":
            row["present"] += 1
        else:
            row["absent"] += 1

    rows = []
    total_classes = total_done = 0
    for subj in sorted(by_subject):
        row = by_subject[subj]
        done = min(row["classes_done"], row["total_classes"])
        left = max(0, row["total_classes"] - done)
        rate = round(100 * row["present"] / done, 1) if done else 0.0
        rows.append(
            {
                "subject": subj,
                "total_classes": row["total_classes"],
                "classes_done": done,
                "classes_left": left,
                "present": row["present"],
                "absent": row["absent"],
                "attendance_rate": rate,
            }
        )
        total_classes += row["total_classes"]
        total_done += done

    return {
        "subjects": rows,
        "summary": {
            "total_classes": total_classes,
            "classes_done": total_done,
            "classes_left": max(0, total_classes - total_done),
        },
    }


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@app.get("/", include_in_schema=False)
def root():
    """Serve the app shell at the base URL (API listing lives in /api/docs)."""
    return FileResponse("static/index.html")


@app.post("/api/students", status_code=201)
def create_student(body: StudentCreate, db=Depends(get_db)):
    if db.query(Student).filter_by(name=body.name).first():
        raise HTTPException(status_code=409, detail="A student with this name already exists")

    student = Student(student_id=f"st_{uuid.uuid4().hex[:10]}", name=body.name, target_exam=body.target_exam)
    db.add(student)
    db.commit()

    # initial roadmap: everything unlearned -> foundation-first plan
    graph = CurriculumGraph(db)
    resolver = PrerequisiteResolver(db, graph)
    priority = PriorityEngine(db, graph, resolver)
    generator = RoadmapGenerator(db, priority, resolver, graph)

    roadmap = Roadmap(
        roadmap_id=f"rm_{uuid.uuid4().hex[:10]}",
        student_id=student.student_id,
        version=1,
        status="ACTIVE",
        trigger_event="ONBOARDING",
    )
    db.add(roadmap)
    db.flush()
    for a in generator.generate_roadmap(student.student_id, max_actions=8):
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
    db.commit()
    return {"student_id": student.student_id, "name": student.name, "target_exam": student.target_exam}


@app.get("/api/students/{student_id}/dashboard")
def dashboard(student_id: str, db=Depends(get_db)):
    student = _get_student_or_404(db, student_id)
    refresh_forgetting_risk(db, student_id)
    overview = _mastery_overview(db, student_id)
    concepts = overview["concepts"]

    return {
        "student": {
            "student_id": student.student_id,
            "name": student.name,
            "target_exam": student.target_exam,
            "irt_ability": round(student.irt_ability, 3),
        },
        "stats": {
            "mastered_count": overview["mastered_count"],
            "total_concepts": len(concepts),
            "avg_mastery": round(sum(c["mastery"] for c in concepts) / len(concepts), 3) if concepts else 0.0,
            "attempts": sum(c["attempts_count"] for c in concepts),
        },
        "roadmap": _roadmap_payload(db, student_id),
        "mastery": overview,
    }


@app.get("/api/students/{student_id}/quiz/{concept_id}")
def get_quiz(student_id: str, concept_id: str, count: int = 5, difficulty: float = 0.5, db=Depends(get_db)):
    _get_student_or_404(db, student_id)
    if db.query(Concept).filter_by(concept_id=concept_id).first() is None:
        raise HTTPException(status_code=404, detail="Concept not found")

    pool = db.query(Question).filter_by(concept_id=concept_id).all()
    if not pool:
        raise HTTPException(status_code=404, detail="No questions for this concept yet")

    # pick `count` questions closest to the action's target difficulty
    pool.sort(key=lambda q: abs(q.difficulty - difficulty))
    chosen = pool[:count]
    random.shuffle(chosen)

    return {
        "concept_id": concept_id,
        "concept_name": db.query(Concept).filter_by(concept_id=concept_id).first().name,
        "questions": [
            {
                "question_id": q.question_id,
                "question_text": q.question_text,
                "options": json.loads(q.options),
                "estimated_time_seconds": q.estimated_time_seconds,
            }
            for q in chosen
        ],
    }


@app.post("/api/assessments/submit")
def submit_assessment(body: AssessmentSubmit, db=Depends(get_db)):
    _get_student_or_404(db, body.student_id)
    if not body.responses:
        raise HTTPException(status_code=422, detail="No responses submitted")

    result = process_responses(
        db,
        body.student_id,
        [r.model_dump() for r in body.responses],
    )
    return result


@app.get("/api/curriculum")
def curriculum(db=Depends(get_db)):
    graph = CurriculumGraph(db)
    concepts = db.query(Concept).all()
    return {
        "concepts": [
            {
                "concept_id": c.concept_id,
                "name": c.name,
                "topic_id": c.topic_id,
                "description": c.description,
                "exam_relevance": c.exam_relevance,
                "difficulty_weight": c.difficulty_weight,
                "prerequisite_impact": graph.get_prerequisite_impact(c.concept_id),
            }
            for c in concepts
        ],
        "edges": [
            {"from": e.from_concept_id, "to": e.to_concept_id, "strength": e.strength}
            for e in db.query(Prerequisite).all()
        ],
    }


@app.get("/api/students/{student_id}/mastery")
def mastery(student_id: str, db=Depends(get_db)):
    _get_student_or_404(db, student_id)
    refresh_forgetting_risk(db, student_id)
    return _mastery_overview(db, student_id)


@app.get("/api/students/{student_id}/subjects")
def subjects(student_id: str, db=Depends(get_db)):
    _get_student_or_404(db, student_id)
    refresh_forgetting_risk(db, student_id)
    return _subjects_overview(db, student_id)


# --------------------------------------------------------------------------
# Assignments (give / list / mark done)
# --------------------------------------------------------------------------


@app.get("/api/students/{student_id}/assignments")
def list_assignments(student_id: str, db=Depends(get_db)):
    _get_student_or_404(db, student_id)
    rows = (
        db.query(Assignment)
        .filter_by(student_id=student_id)
        .order_by(Assignment.created_at.desc())
        .all()
    )
    return {"assignments": [_assignment_payload(a) for a in rows]}


@app.post("/api/assignments", status_code=201)
def create_assignment(body: AssignmentCreate, db=Depends(get_db)):
    _get_student_or_404(db, body.student_id)
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Assignment title is required")
    row = Assignment(
        assignment_id=f"as_{uuid.uuid4().hex[:10]}",
        student_id=body.student_id,
        title=body.title.strip(),
        subject=body.subject.strip() or "General",
        description=body.description.strip(),
        due_date=body.due_date,
        status="open",
    )
    db.add(row)
    db.commit()
    return _assignment_payload(row)


@app.patch("/api/assignments/{assignment_id}")
def update_assignment(assignment_id: str, body: AssignmentStatus, db=Depends(get_db)):
    row = db.query(Assignment).filter_by(assignment_id=assignment_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if body.status not in ("open", "done"):
        raise HTTPException(status_code=422, detail="status must be 'open' or 'done'")
    row.status = body.status
    db.commit()
    return _assignment_payload(row)


# --------------------------------------------------------------------------
# Attendance (classes done vs. left, per subject)
# --------------------------------------------------------------------------


@app.get("/api/students/{student_id}/attendance")
def attendance(student_id: str, db=Depends(get_db)):
    _get_student_or_404(db, student_id)
    return _attendance_summary(db, student_id)


@app.post("/api/students/{student_id}/attendance")
def mark_attendance(student_id: str, body: AttendanceMark, db=Depends(get_db)):
    _get_student_or_404(db, student_id)
    if not body.subject.strip():
        raise HTTPException(status_code=422, detail="subject is required")

    schedule = db.query(SubjectSchedule).filter_by(student_id=student_id, subject=body.subject).first()
    if schedule is None:
        schedule = SubjectSchedule(student_id=student_id, subject=body.subject, total_classes=12, classes_done=0)
        db.add(schedule)
    if body.total_classes is not None:
        if body.total_classes < schedule.classes_done:
            raise HTTPException(status_code=422, detail="total_classes cannot be less than classes already done")
        schedule.total_classes = body.total_classes

    if schedule.classes_done >= schedule.total_classes:
        db.commit()
        raise HTTPException(status_code=409, detail="All classes for this subject are done — raise the total first")

    schedule.classes_done += 1
    db.add(
        AttendanceRecord(
            student_id=student_id,
            subject=body.subject,
            class_number=schedule.classes_done,
            status=body.status if body.status in ("PRESENT", "ABSENT") else "PRESENT",
        )
    )
    db.commit()
    return _attendance_summary(db, student_id)


# --------------------------------------------------------------------------
# Static frontend
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Question bank (ingest more questions)
# --------------------------------------------------------------------------


@app.post("/api/questions", status_code=201)
def add_question(body: question_bank.QuestionCreate, db=Depends(get_db)):
    result = question_bank.add_questions(db, [body])
    outcome = result["results"][0]
    if outcome["status"] == "error":
        raise HTTPException(status_code=422, detail=outcome["error"])
    if outcome["status"] == "skipped":
        raise HTTPException(
            status_code=409,
            detail=f"A question with ID '{outcome['question_id']}' already exists "
            "(use /api/questions/batch with replace=true to overwrite)",
        )
    row = db.query(Question).filter_by(question_id=outcome["question_id"]).first()
    return _question_payload(row)


@app.post("/api/questions/batch")
def add_questions_batch(body: QuestionBatch, db=Depends(get_db)):
    if not body.questions:
        raise HTTPException(status_code=422, detail="No questions supplied")
    return question_bank.add_questions(db, body.questions, replace=body.replace)


@app.get("/api/questions")
def list_questions(concept_id: str = None, db=Depends(get_db)):
    query = db.query(Question)
    if concept_id:
        if db.query(Concept).filter_by(concept_id=concept_id).first() is None:
            raise HTTPException(status_code=404, detail="Concept not found")
        query = query.filter_by(concept_id=concept_id)
    rows = query.order_by(Question.question_id).all()
    return {"count": len(rows), "questions": [_question_payload(r) for r in rows]}


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/app", include_in_schema=False)
@app.get("/app/{path:path}", include_in_schema=False)
def spa(path: str = ""):
    return FileResponse("static/index.html")


@app.get("/{path:path}", include_in_schema=False)
def spa_fallback(path: str):
    """Deep links into the SPA (e.g. /subjects, /plan, /quiz/c05/REVIEW) serve
    the app shell; the frontend route() picks the page up. API/static are
    matched earlier and never reach here."""
    if path.startswith(("api/", "static/")):
        raise HTTPException(status_code=404)
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)