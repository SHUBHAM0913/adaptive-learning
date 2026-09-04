"""Unit tests for the five engines + error classifier (blueprint Phase 6).

Pure-function tests only — no DB required. The reference behaviour lives in
Downloads/context.md ("Quick Reference: All Formulas in One Place").
"""

from datetime import datetime, timedelta, timezone

from engines.bkt import BayesianKnowledgeTracing
from engines.error_classifier import classify_error
from engines.forgetting import ForgettingModel
from engines.irt import ItemResponseTheory
from engines.mastery import calculate_confidence, calculate_speed_factor, compute_mastery


# ---------------------------------------------------------------------------
# Engine 2 — BKT
# ---------------------------------------------------------------------------


def test_bkt_converges_upward_on_correct_answers():
    bkt = BayesianKnowledgeTracing()
    p = bkt.compute_sequence_mastery([True] * 6)
    assert 0.5 < p <= 0.99


def test_bkt_stays_low_after_wrong_answers():
    bkt = BayesianKnowledgeTracing()
    right = bkt.compute_sequence_mastery([True] * 6)
    wrong = bkt.compute_sequence_mastery([False] * 6)
    assert wrong < right
    assert wrong >= 0.01  # never below the floor


def test_bkt_single_step_bounds():
    bkt = BayesianKnowledgeTracing()
    for current in (0.0, 0.2, 0.5, 0.99):
        for outcome in (True, False):
            nxt = bkt.update_single_step(current, outcome)
            assert 0.01 <= nxt <= 0.99


# ---------------------------------------------------------------------------
# Engine 3 — IRT
# ---------------------------------------------------------------------------


def test_irt_b_parameter_mapping():
    assert ItemResponseTheory.difficulty_to_b_parameter(0.5) == 0.0
    assert ItemResponseTheory.difficulty_to_b_parameter(0.9) > 0.0
    assert ItemResponseTheory.difficulty_to_b_parameter(0.1) < 0.0


def test_irt_perfect_easy_answers_raise_theta():
    responses = [(True, 0.2, 1.2)] * 8
    theta = ItemResponseTheory.estimate_student_ability(responses)
    assert theta > 0.0


def test_irt_all_wrong_hard_answers_lower_theta():
    responses = [(False, 0.9, 1.2)] * 8
    theta = ItemResponseTheory.estimate_student_ability(responses)
    assert theta < 0.0


def test_irt_empty_responses_return_initial_theta():
    assert ItemResponseTheory.estimate_student_ability([]) == 0.0


def test_irt_probability_curve_shape():
    # Higher ability => higher probability of a correct answer.
    low = ItemResponseTheory.probability_correct(-2.0, 0.0, 1.0, 0.25)
    high = ItemResponseTheory.probability_correct(+2.0, 0.0, 1.0, 0.25)
    assert low < high
    assert 0.25 <= low <= 1.0


# ---------------------------------------------------------------------------
# Engine 4 — Ebbinghaus forgetting
# ---------------------------------------------------------------------------


def test_forgetting_decays_over_two_weeks():
    fm = ForgettingModel()
    now = datetime(2026, 1, 15, tzinfo=timezone.utc)
    two_weeks_ago = now - timedelta(days=14)
    r = fm.calculate_retention(0.8, two_weeks_ago, review_count=0, now=now)
    assert r["retention_score"] < 0.70
    assert r["forgetting_risk"] > 0.30
    assert r["effective_mastery"] < 0.8


def test_forgetting_no_decay_when_fresh():
    fm = ForgettingModel()
    now = datetime(2026, 1, 15, tzinfo=timezone.utc)
    an_hour_ago = now - timedelta(hours=1)
    r = fm.calculate_retention(0.8, an_hour_ago, review_count=0, now=now)
    assert r["retention_score"] >= 0.99
    assert r["forgetting_risk"] <= 0.01


def test_forgetting_handles_naive_datetime():
    fm = ForgettingModel()
    now = datetime(2026, 1, 15, tzinfo=timezone.utc)
    naive_past = now.replace(tzinfo=None) - timedelta(days=7)
    r = fm.calculate_retention(0.8, naive_past, review_count=0, now=now)
    assert 0.0 <= r["retention_score"] <= 1.0


def test_forgetting_reviews_extend_memory():
    fm = ForgettingModel()
    now = datetime(2026, 1, 15, tzinfo=timezone.utc)
    week_ago = now - timedelta(days=7)
    fresh = fm.calculate_retention(0.8, week_ago, review_count=0, now=now)
    reviewed = fm.calculate_retention(0.8, week_ago, review_count=4, now=now)
    assert reviewed["retention_score"] > fresh["retention_score"]


def test_forgetting_no_history_means_no_decay():
    fm = ForgettingModel()
    r = fm.calculate_retention(0.8, None, review_count=0)
    assert r["retention_score"] == 1.0
    assert r["forgetting_risk"] == 0.0


# ---------------------------------------------------------------------------
# Engine 1 — multi-factor mastery
# ---------------------------------------------------------------------------


def test_mastery_empty_attempts():
    r = compute_mastery([])
    assert r == {"mastery": 0.0, "confidence": 0.10}


def test_mastery_perfect_answers_score_high():
    attempts = [
        {"is_correct": True, "difficulty": 0.3 + 0.1 * i, "time_taken_seconds": 45}
        for i in range(8)
    ]
    r = compute_mastery(attempts)
    assert r["mastery"] >= 0.9
    assert 0.10 <= r["confidence"] <= 0.98


def test_mastery_mixed_answers_score_lower():
    good = [
        {"is_correct": True, "difficulty": 0.5, "time_taken_seconds": 45}
        for _ in range(8)
    ]
    mixed = good[:4] + [
        {"is_correct": False, "difficulty": 0.5, "time_taken_seconds": 8}
        for _ in range(4)
    ]
    assert compute_mastery(mixed)["mastery"] < compute_mastery(good)["mastery"]


def test_speed_factor_rules():
    assert calculate_speed_factor(5, 60) == 0.50        # guessed, too fast
    assert calculate_speed_factor(40, 60) == 1.0        # on time
    assert calculate_speed_factor(90, 60) < 1.0         # slow penalty
    assert calculate_speed_factor(300, 60) >= 0.30      # floor
    assert calculate_speed_factor(60, 0) == 1.0         # no expected time


def test_confidence_grows_with_sample_size():
    small = calculate_confidence(2, 0.0)
    large = calculate_confidence(20, 0.0)
    assert large > small


# ---------------------------------------------------------------------------
# Cognitive error classifier
# ---------------------------------------------------------------------------


DISTRACTORS = {
    "A": "CONCEPTUAL_ERROR: Speed is a scalar.",
    "B": "CALCULATION_ERROR: You divided instead of multiplying.",
    "C": "FORMULA_SELECTION_ERROR: Wrong equation picked.",
}


def test_classifier_correct_answer():
    assert classify_error(DISTRACTORS, "D", "D", 30)["error_type"] is None


def test_classifier_timed_out_and_skipped():
    assert classify_error(DISTRACTORS, "", "D", 90)["error_type"] == "TIME_PRESSURE"
    assert classify_error(DISTRACTORS, "", "D", 5)["error_type"] == "SKIPPED"


def test_classifier_reads_distractor_tag():
    r = classify_error(DISTRACTORS, "A", "D", 40)
    assert r["error_type"] == "CONCEPTUAL_ERROR"
    assert "CONCEPTUAL_ERROR" in r["note"]


def test_classifier_guess_when_too_fast():
    # answer key is NOT a tagged distractor and the answer came too fast
    r = classify_error(
        {"C": "SIGN_ERROR: inverted the ratio"}, "A", "D", 3, estimated_time_seconds=60
    )
    assert r["error_type"] == "GUESS"


def test_classifier_long_deliberation_is_conceptual():
    r = classify_error({}, "A", "D", 200, estimated_time_seconds=60)
    assert r["error_type"] == "CONCEPTUAL_ERROR"


def test_classifier_fallback_unknown():
    assert classify_error({}, "A", "D", 30)["error_type"] == "UNKNOWN"
