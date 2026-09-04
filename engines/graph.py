"""Engine 5 — Prerequisite DAG + Root-Cause Gap Interceptor.

Builds the curriculum as a NetworkX DiGraph (edge A->B means "know A before B")
and finds which broken foundational concept is the TRUE root cause of failure
in an advanced topic.
"""

import networkx as nx

MASTERY_THRESHOLD = 0.60  # mastery needed before a concept counts as "known"


class CurriculumGraph:
    def __init__(self, db):
        self.db = db
        self.graph = nx.DiGraph()
        self._build_graph()

    def _build_graph(self):
        from models import Concept, Prerequisite

        concepts = self.db.query(Concept).all()
        for c in concepts:
            self.graph.add_node(
                c.concept_id,
                name=c.name,
                topic_id=c.topic_id,
                description=c.description,
                exam_relevance=c.exam_relevance,
                difficulty_weight=c.difficulty_weight,
                estimated_minutes=c.estimated_minutes,
            )

        prereqs = self.db.query(Prerequisite).all()
        for p in prereqs:
            self.graph.add_edge(
                p.from_concept_id,
                p.to_concept_id,
                strength=p.strength,
                relationship=p.relationship_type,
            )

    def concept_name(self, concept_id: str) -> str:
        data = self.graph.nodes.get(concept_id)
        return data.get("name", concept_id) if data else concept_id

    def get_all_prerequisites(self, concept_id: str) -> list:
        """All ancestors of concept_id in topological order, oldest first."""
        if concept_id not in self.graph:
            return []
        ancestors = nx.ancestors(self.graph, concept_id)
        if not ancestors:
            return []
        sub = self.graph.subgraph(ancestors | {concept_id})
        order = list(nx.topological_sort(sub))
        # drop the target itself; keep the rest in topological (foundation-first) order
        return [n for n in order if n != concept_id]

    def get_prerequisite_impact(self, concept_id: str) -> float:
        if concept_id not in self.graph:
            return 0.1
        descendants = nx.descendants(self.graph, concept_id)
        total_nodes = len(self.graph.nodes)
        direct_out = len(list(self.graph.successors(concept_id)))
        downstream_ratio = len(descendants) / max(total_nodes - 1, 1)
        impact = 0.4 * min(direct_out / 3.0, 1.0) + 0.6 * downstream_ratio
        return round(min(max(impact, 0.1), 1.0), 3)

    def top_dependents(self, concept_id: str, k: int = 3) -> list:
        """Names of the k most immediate dependent concepts (unlocks these)."""
        succ = list(self.graph.successors(concept_id))
        return [self.concept_name(s) for s in succ[:k]]


class PrerequisiteResolver:
    def __init__(self, db, curriculum_graph: CurriculumGraph):
        self.db = db
        self.graph = curriculum_graph

    def analyze_prerequisite_chain(
        self, student_id: str, target_concept_id: str, mastery_threshold: float = MASTERY_THRESHOLD
    ) -> dict:
        ancestors = self.graph.get_all_prerequisites(target_concept_id)

        broken = []
        for ancestor_id in ancestors:
            mastery = get_student_mastery(self.db, student_id, ancestor_id)
            if mastery < mastery_threshold:
                broken.append(
                    {
                        "concept_id": ancestor_id,
                        "name": self.graph.concept_name(ancestor_id),
                        "mastery": mastery,
                        "required": mastery_threshold,
                    }
                )

        return {
            "has_prerequisite_gaps": len(broken) > 0,
            "broken_prerequisites": broken,
            "recommended_first_concept": broken[0]["concept_id"] if broken else target_concept_id,
        }


def get_student_mastery(db, student_id: str, concept_id: str) -> float:
    from models import StudentConceptMastery

    rec = (
        db.query(StudentConceptMastery)
        .filter_by(student_id=student_id, concept_id=concept_id)
        .first()
    )
    return rec.mastery if rec else 0.0