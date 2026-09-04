"""Cognitive Error Classifier — determines WHY a student got a question wrong.

Uses the chosen distractor (which carries a tagged explanation) plus timing
to classify CONCEPTUAL_ERROR, CALCULATION_ERROR, FORMULA_SELECTION_ERROR,
SIGN_ERROR, GUESS, TIME_PRESSURE, SKIPPED, or UNKNOWN.
"""


def classify_error(
    distractor_explanations: dict,
    student_answer: str,
    correct_answer: str,
    time_taken_seconds: int,
    estimated_time_seconds: int = 60,
) -> dict:
    if student_answer == correct_answer:
        return {"error_type": None, "note": "Correct response"}

    if not student_answer:
        if time_taken_seconds >= estimated_time_seconds:
            return {"error_type": "TIME_PRESSURE", "note": "Ran out of time"}
        return {"error_type": "SKIPPED", "note": "Question skipped"}

    if distractor_explanations and student_answer in distractor_explanations:
        raw = distractor_explanations[student_answer]
        for tag in [
            "CONCEPTUAL_ERROR",
            "FORMULA_SELECTION_ERROR",
            "CALCULATION_ERROR",
            "SIGN_ERROR",
            "UNIT_ERROR",
            "READING_ERROR",
            "CARELESS_ERROR",
        ]:
            if tag in raw:
                return {"error_type": tag, "note": raw}

    if time_taken_seconds < max(10, estimated_time_seconds * 0.20):
        return {
            "error_type": "GUESS",
            "note": f"Answered in {time_taken_seconds}s — too fast to reason through",
        }

    if time_taken_seconds > estimated_time_seconds * 2.0:
        return {
            "error_type": "CONCEPTUAL_ERROR",
            "note": "Long deliberation suggests conceptual struggle",
        }

    return {"error_type": "UNKNOWN", "note": "Standard incorrect attempt"}