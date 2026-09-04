"""Adaptive Learning Platform — FastAPI backend.

Endpoints:
  POST /api/students                  create a student
  GET  /api/students/{id}/dashboard   dashboard: roadmap + mastery overview
  GET  /api/students/{id}/quiz/{concept}   quiz for a roadmap action
  POST /api/assessments/submit        full five-engine assessment pipeline
  GET  /api/curriculum                concepts + prerequisite edges (graph view)
  GET  /api/students/{id}/mastery     heatmap data for every concept
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
    Concept,
    Prerequisite,
    Question,
    Roadmap,
    RoadmapAction,
    Student,
    StudentConceptMastery,
    StudentAttemptItem,
)
from pipeline import process_responses, refresh_forgetting_risk

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


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


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
            }
        )
    rows.sort(key=lambda x: x["concept_id"])
    mastered = sum(1 for r in rows if r["mastery"] >= 0.70)
    forgetting = [r for r in rows if r["forgetting_risk"] > 0.35 and r["attempts_count"] > 0]
    return {"concepts": rows, "mastered_count": mastered, "forgetting_alerts": forgetting}


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@app.get("/")
def root():
    return {
        "message": "Adaptive Learning Platform",
        "docs": "/api/docs",
        "endpoints": {
            "students": "POST /api/students",
            "dashboard": "GET /api/students/{id}/dashboard",
            "quiz": "GET /api/students/{id}/quiz/{concept_id}",
            "submit": "POST /api/assessments/submit",
            "curriculum": "GET /api/curriculum",
            "mastery": "GET /api/students/{id}/mastery",
        },
    }


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


# --------------------------------------------------------------------------
# Static frontend
# --------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/app", include_in_schema=False)
@app.get("/app/{path:path}", include_in_schema=False)
def spa(path: str = ""):
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)