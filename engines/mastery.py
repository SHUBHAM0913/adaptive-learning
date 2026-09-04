"""Engine 1 — Multi-Factor Mastery Engine.

Computes a weighted composite mastery score M in [0, 1] from accuracy,
difficulty-weighted performance, recent trend, speed, consistency, and retention.
"""

import math


class MasteryConfig:
    WEIGHT_ACCURACY: float = 0.30
    WEIGHT_DIFFICULTY_PERF: float = 0.20
    WEIGHT_RECENT_ACCURACY: float = 0.15
    WEIGHT_RETENTION: float = 0.15
    WEIGHT_CONSISTENCY: float = 0.10
    WEIGHT_SPEED: float = 0.10
    SAMPLE_SIZE_HALF_CONFIDENCE: float = 5.0


def calculate_speed_factor(avg_time_sec: float, expected_time_sec: float) -> float:
    if expected_time_sec <= 0:
        expected_time_sec = 60.0
    ratio = avg_time_sec / expected_time_sec
    if ratio <= 0.2:
        return 0.50  # too fast -> probably guessed
    elif ratio <= 1.0:
        return 1.0  # on time -> good
    elif ratio <= 2.0:
        return max(0.60, 1.0 - 0.4 * (ratio - 1.0))
    else:
        return max(0.30, 0.60 - 0.15 * (ratio - 2.0))


def calculate_confidence(attempt_count: int, variance: float = 0.0) -> float:
    """Confidence in the mastery estimate; low attempt counts -> low confidence."""
    if attempt_count <= 0:
        return 0.10
    sample_factor = 1.0 - math.exp(-attempt_count / 5.0)
    consistency_bonus = max(0.0, 1.0 - variance) * 0.15
    confidence = 0.85 * sample_factor + consistency_bonus
    return round(min(max(confidence, 0.10), 0.98), 3)


def compute_mastery(attempts: list, config: MasteryConfig = None) -> dict:
    """attempts: list of dicts with is_correct (bool), difficulty (0-1),
    time_taken_seconds (int). Returns {"mastery", "confidence"}."""
    if config is None:
        config = MasteryConfig()
    if not attempts:
        return {"mastery": 0.0, "confidence": 0.10}

    total = len(attempts)
    correct = sum(1 for a in attempts if a["is_correct"])
    historical_accuracy = correct / total

    recent = attempts[-5:]
    recent_accuracy = sum(1 for a in recent if a["is_correct"]) / len(recent)

    diff_score = 0.0
    diff_total = 0.0
    for a in attempts:
        d = a.get("difficulty", 0.5)
        w = 0.5 + d
        diff_total += w
        if a["is_correct"]:
            diff_score += w
    difficulty_performance = diff_score / max(diff_total, 1e-6)

    avg_time = sum(a.get("time_taken_seconds", 60) for a in attempts) / total
    speed = calculate_speed_factor(avg_time, 60.0)

    scores = [1.0 if a["is_correct"] else 0.0 for a in attempts]
    mean = sum(scores) / len(scores)
    variance = (
        sum((s - mean) ** 2 for s in scores) / len(scores)
        if len(scores) > 1
        else 0.25
    )
    consistency = max(0.0, 1.0 - variance)

    mastery = (
        config.WEIGHT_ACCURACY * historical_accuracy
        + config.WEIGHT_DIFFICULTY_PERF * difficulty_performance
        + config.WEIGHT_RECENT_ACCURACY * recent_accuracy
        + config.WEIGHT_RETENTION * 1.0  # retention applied separately by Engine 4
        + config.WEIGHT_CONSISTENCY * consistency
        + config.WEIGHT_SPEED * speed
    )
    mastery = round(min(max(mastery, 0.0), 1.0), 3)
    confidence = calculate_confidence(total, variance)

    return {"mastery": mastery, "confidence": confidence}