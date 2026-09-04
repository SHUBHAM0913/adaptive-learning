"""Engine 4 — Ebbinghaus Forgetting and Retention Engine.

Decays mastery over elapsed time since last practice, with memory stability
growing each time the concept is reviewed. Produces a forgetting risk used
to prioritize spaced-repetition reviews.
"""

import datetime
import math


class ForgettingModel:
    def __init__(
        self,
        base_half_life_days: float = 7.0,
        reinforcement_multiplier: float = 0.50,
        floor_retention: float = 0.35,
    ):
        self.base_half_life_days = base_half_life_days
        self.reinforcement_multiplier = reinforcement_multiplier
        self.floor_retention = floor_retention

    @staticmethod
    def _as_utc(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=datetime.timezone.utc)
        return dt

    def calculate_retention(
        self,
        base_mastery: float,
        last_practiced_at: datetime.datetime,
        review_count: int = 0,
        now: datetime.datetime = None,
    ) -> dict:
        if base_mastery <= 0.0 or not last_practiced_at:
            return {
                "retention_score": 1.0,
                "effective_mastery": base_mastery,
                "forgetting_risk": 0.0,
                "days_since_practice": 0.0,
            }

        now = now or datetime.datetime.now(datetime.timezone.utc)
        last = self._as_utc(last_practiced_at)
        elapsed_seconds = max(0.0, (now - last).total_seconds())
        days_elapsed = elapsed_seconds / 86400.0

        stability_days = self.base_half_life_days * (
            1.0 + review_count * self.reinforcement_multiplier
        )
        decay_constant = math.log(2) / stability_days

        retention = math.exp(-decay_constant * days_elapsed)
        retention_clamped = max(self.floor_retention, min(1.0, retention))

        effective_mastery = round(base_mastery * retention_clamped, 3)
        forgetting_risk = round(max(0.0, 1.0 - retention_clamped), 3)

        return {
            "retention_score": round(retention_clamped, 3),
            "effective_mastery": effective_mastery,
            "forgetting_risk": forgetting_risk,
            "days_since_practice": round(days_elapsed, 2),
        }