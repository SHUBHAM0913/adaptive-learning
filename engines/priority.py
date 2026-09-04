"""Priority Engine — ranks every concept by urgency, with explainable reasons.

Priority = gap*0.35 + exam_weight*0.25 + prereq_impact*0.25
           + forgetting_risk*0.08 + (1-confidence)*0.07
"""


class PriorityEngine:
    def __init__(self, db, curriculum_graph, prereq_resolver):
        self.db = db
        self.graph = curriculum_graph
        self.prereq_resolver = prereq_resolver

    def calculate_priority(self, concept, mastery_record, student_id: str) -> dict:
        mastery = mastery_record.mastery if mastery_record else 0.0
        confidence = mastery_record.confidence if mastery_record else 0.10
        forgetting_risk = mastery_record.forgetting_risk if mastery_record else 0.0

        knowledge_gap = 1.0 - mastery
        exam_importance = concept.exam_relevance
        prereq_impact = self.graph.get_prerequisite_impact(concept.concept_id)
        prereq_check = self.prereq_resolver.analyze_prerequisite_chain(
            student_id, concept.concept_id
        )

        raw_score = (
            knowledge_gap * 0.35
            + exam_importance * 0.25
            + prereq_impact * 0.25
            + forgetting_risk * 0.08
            + (1.0 - confidence) * 0.07
        )
        priority_score = round(min(max(raw_score, 0.05), 0.99), 3)

        reasons = []
        if mastery < 0.40:
            reasons.append(f"Critical knowledge gap — mastery only {int(mastery * 100)}%")
        elif mastery < 0.70:
            reasons.append(f"Moderate mastery ({int(mastery * 100)}%) below target")
        if exam_importance >= 0.90:
            reasons.append(f"High exam weight ({int(exam_importance * 100)}% relevance)")
        if prereq_impact >= 0.60:
            dependents = ", ".join(self.graph.top_dependents(concept.concept_id))
            reasons.append(
                f"Key foundational concept — unlocks: {dependents or 'downstream topics'}"
            )
        if forgetting_risk > 0.35:
            reasons.append(f"Spaced-repetition alert — {int(forgetting_risk * 100)}% forgetting risk")
        if prereq_check["has_prerequisite_gaps"]:
            first = prereq_check["broken_prerequisites"][0]
            reasons.append(
                f"Notice: prerequisite '{first['name']}' (mastery {int(first['mastery'] * 100)}%) must be fixed first"
            )

        return {
            "concept_id": concept.concept_id,
            "concept_name": concept.name,
            "priority_score": priority_score,
            "knowledge_gap": round(knowledge_gap, 3),
            "exam_importance": exam_importance,
            "prereq_impact": prereq_impact,
            "forgetting_risk": forgetting_risk,
            "has_unresolved_prerequisites": prereq_check["has_prerequisite_gaps"],
            "reasons": reasons,
        }

    def rank_all_priorities(self, student_id: str) -> list:
        from models import Concept, StudentConceptMastery

        concepts = self.db.query(Concept).all()
        records = {
            r.concept_id: r
            for r in self.db.query(StudentConceptMastery)
            .filter_by(student_id=student_id)
            .all()
        }
        ranked = []
        for c in concepts:
            ranked.append(
                self.calculate_priority(c, records.get(c.concept_id), student_id)
            )
        ranked.sort(key=lambda r: r["priority_score"], reverse=True)
        return ranked