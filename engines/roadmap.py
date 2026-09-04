"""Roadmap Generator — turns ranked priorities into an ordered study plan.

Intercepts broken prerequisites: if an advanced concept ranks high but a
foundational prerequisite is broken, the prerequisite is inserted FIRST with
a "root foundational gap" reason.
"""


class RoadmapGenerator:
    def __init__(self, db, priority_engine, prereq_resolver, curriculum_graph):
        self.db = db
        self.priority_engine = priority_engine
        self.prereq_resolver = prereq_resolver
        self.graph = curriculum_graph

    def determine_action_type(self, mastery: float, forgetting_risk: float) -> dict:
        if forgetting_risk > 0.40 and mastery >= 0.50:
            return {
                "action_type": "RETENTION_DRILL",
                "questions_count": 5,
                "estimated_minutes": 20,
                "target_difficulty": 0.60,
            }
        if mastery < 0.35:
            return {
                "action_type": "FOUNDATION_REBUILD",
                "questions_count": 5,
                "estimated_minutes": 45,
                "target_difficulty": 0.40,
            }
        if mastery < 0.55:
            return {
                "action_type": "SPEED_PRACTICE",
                "questions_count": 7,
                "estimated_minutes": 30,
                "target_difficulty": 0.55,
            }
        if mastery < 0.75:
            return {
                "action_type": "MULTI_CONCEPT_DRILL",
                "questions_count": 6,
                "estimated_minutes": 35,
                "target_difficulty": 0.70,
            }
        if mastery < 0.88:
            return {
                "action_type": "ADVANCED_PRACTICE",
                "questions_count": 5,
                "estimated_minutes": 40,
                "target_difficulty": 0.85,
            }
        return {
            "action_type": "TRANSFER_TEST",
            "questions_count": 4,
            "estimated_minutes": 20,
            "target_difficulty": 0.85,
        }

    def generate_roadmap(self, student_id: str, max_actions: int = 6) -> list:
        ranked = self.priority_engine.rank_all_priorities(student_id)
        actions = []
        visited = set()

        for rank in ranked:
            if len(actions) >= max_actions:
                break

            concept_id = rank["concept_id"]
            prereq_check = self.prereq_resolver.analyze_prerequisite_chain(
                student_id, concept_id
            )

            if prereq_check["has_prerequisite_gaps"]:
                for broken in prereq_check["broken_prerequisites"]:
                    if broken["concept_id"] in visited or len(actions) >= max_actions:
                        continue
                    actions.append(
                        {
                            "concept_id": broken["concept_id"],
                            "concept_name": broken["name"],
                            "priority_score": 0.95,
                            "reasons": [
                                f"Root foundational gap blocking '{self._name(concept_id)}'",
                                f"Mastery {int(broken['mastery'] * 100)}% — needs {int(broken['required'] * 100)}% to unlock downstream",
                            ],
                            "action_type": "FOUNDATION_REBUILD",
                            "questions_count": 5,
                            "estimated_minutes": 45,
                            "target_difficulty": 0.40,
                        }
                    )
                    visited.add(broken["concept_id"])

            if concept_id not in visited and len(actions) < max_actions:
                rec = self._mastery_record(student_id, concept_id)
                mastery = rec.mastery if rec else 0.0
                forgetting_risk = rec.forgetting_risk if rec else 0.0
                action_plan = self.determine_action_type(mastery, forgetting_risk)
                actions.append(
                    {
                        "concept_id": concept_id,
                        "concept_name": self._name(concept_id),
                        "priority_score": rank["priority_score"],
                        "reasons": rank["reasons"],
                        **action_plan,
                    }
                )
                visited.add(concept_id)

        # Guaranteed spaced repetition: a concept the student is about to
        # forget would otherwise never surface while knowledge gaps dominate
        # the ranking (forgetting carries only 0.08 weight in the score).
        # Up to 2 extra retention slots are appended so reviews actually happen.
        retention_candidates = []
        for rank in ranked:
            cid = rank["concept_id"]
            if cid in visited:
                continue
            rec = self._mastery_record(student_id, cid)
            if rec and rec.mastery >= 0.70 and rec.forgetting_risk > 0.45:
                retention_candidates.append((cid, rec))
        retention_candidates.sort(key=lambda x: x[1].forgetting_risk, reverse=True)
        for cid, rec in retention_candidates:
            if len(actions) >= max_actions + 2:
                break
            if cid in visited:
                continue
            plan = self.determine_action_type(rec.mastery, rec.forgetting_risk)
            actions.append(
                {
                    "concept_id": cid,
                    "concept_name": self._name(cid),
                    "priority_score": round(0.5 + rec.forgetting_risk * 0.3, 3),
                    "reasons": [
                        f"Spaced-repetition alert — {int(rec.forgetting_risk * 100)}% forgetting risk",
                        f"Mastery {int(rec.mastery * 100)}% will decay if not reviewed",
                    ],
                    **plan,
                }
            )
            visited.add(cid)

        for i, a in enumerate(actions, start=1):
            a["sequence_order"] = i
        return actions

    def _name(self, concept_id: str) -> str:
        return self.graph.concept_name(concept_id)

    def _mastery_record(self, student_id: str, concept_id: str):
        from models import StudentConceptMastery

        return (
            self.db.query(StudentConceptMastery)
            .filter_by(student_id=student_id, concept_id=concept_id)
            .first()
        )