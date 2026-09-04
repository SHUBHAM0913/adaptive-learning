"""ORM models — mirror the schema in the Adaptive Cognitive Modeling Engine doc."""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)

from database import Base


def utcnow():
    return datetime.now(timezone.utc)


class Student(Base):
    __tablename__ = "students"

    student_id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    target_exam = Column(String, default="Boards")
    irt_ability = Column(Float, default=0.0)
    created_at = Column(DateTime, default=utcnow)


class Concept(Base):
    __tablename__ = "concepts"

    concept_id = Column(String, primary_key=True)
    topic_id = Column(String, default="Mechanics")
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    exam_relevance = Column(Float, default=0.80)
    difficulty_weight = Column(Float, default=0.50)
    estimated_minutes = Column(Integer, default=45)


class Prerequisite(Base):
    __tablename__ = "prerequisites"

    prereq_id = Column(String, primary_key=True)
    from_concept_id = Column(String, ForeignKey("concepts.concept_id"))
    to_concept_id = Column(String, ForeignKey("concepts.concept_id"))
    strength = Column(Float, default=1.0)
    relationship_type = Column(String, default="prerequisite")


class Question(Base):
    __tablename__ = "questions"

    question_id = Column(String, primary_key=True)
    concept_id = Column(String, ForeignKey("concepts.concept_id"))
    question_text = Column(Text, nullable=False)
    options = Column(Text)  # JSON list of 4 strings
    correct_answer = Column(String, nullable=False)  # option key: A/B/C/D
    difficulty = Column(Float, default=0.5)
    discrimination = Column(Float, default=1.0)
    estimated_time_seconds = Column(Integer, default=60)
    distractor_explanations = Column(Text)  # JSON dict option_key -> tagged note


class StudentConceptMastery(Base):
    __tablename__ = "student_concept_mastery"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(String, ForeignKey("students.student_id"))
    concept_id = Column(String, ForeignKey("concepts.concept_id"))
    mastery = Column(Float, default=0.0)
    bkt_mastery = Column(Float, default=0.20)
    irt_ability = Column(Float, default=0.0)
    confidence = Column(Float, default=0.10)
    attempts_count = Column(Integer, default=0)
    correct_count = Column(Integer, default=0)
    forgetting_risk = Column(Float, default=0.0)
    last_practiced_at = Column(DateTime, nullable=True)
    review_count = Column(Integer, default=0)
    updated_at = Column(DateTime, default=utcnow)


class AssessmentAttempt(Base):
    __tablename__ = "assessment_attempts"

    attempt_id = Column(String, primary_key=True)
    student_id = Column(String, ForeignKey("students.student_id"))
    test_tier = Column(String, default="PRACTICE")
    score_percentage = Column(Float, default=0.0)
    irt_theta_estimated = Column(Float, default=0.0)
    created_at = Column(DateTime, default=utcnow)


class StudentAttemptItem(Base):
    __tablename__ = "student_attempt_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    attempt_id = Column(String, ForeignKey("assessment_attempts.attempt_id"))
    student_id = Column(String, ForeignKey("students.student_id"))
    question_id = Column(String, ForeignKey("questions.question_id"))
    concept_id = Column(String, ForeignKey("concepts.concept_id"))
    student_answer = Column(String, nullable=True)
    correct_answer = Column(String)
    is_correct = Column(Boolean, default=False)
    difficulty = Column(Float, default=0.5)
    discrimination = Column(Float, default=1.0)
    time_taken_seconds = Column(Integer, default=0)
    error_type = Column(String, nullable=True)
    distractor_note = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=utcnow)


class Roadmap(Base):
    __tablename__ = "roadmaps"

    roadmap_id = Column(String, primary_key=True)
    student_id = Column(String, ForeignKey("students.student_id"))
    version = Column(Integer, default=1)
    status = Column(String, default="ACTIVE")
    trigger_event = Column(String, default="QUIZ_SUBMIT")
    created_at = Column(DateTime, default=utcnow)


class RoadmapAction(Base):
    __tablename__ = "roadmap_actions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    roadmap_id = Column(String, ForeignKey("roadmaps.roadmap_id"))
    sequence_order = Column(Integer, default=1)
    action_type = Column(String)
    concept_id = Column(String, ForeignKey("concepts.concept_id"))
    priority_score = Column(Float, default=0.5)
    reasons = Column(Text)  # JSON list of reason strings
    target_questions_count = Column(Integer, default=5)
    estimated_minutes = Column(Integer, default=20)
    target_difficulty = Column(Float, default=0.5)
    is_completed = Column(Boolean, default=False)