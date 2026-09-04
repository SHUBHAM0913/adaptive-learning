"""Engine 3 — Item Response Theory (IRT 3PL).

Estimates latent ability theta in [-3, +3] via Newton-Raphson maximum
likelihood over question responses, using discrimination and guessing correction.
"""

import math


class ItemResponseTheory:

    @staticmethod
    def difficulty_to_b_parameter(difficulty_01: float) -> float:
        clamped = min(max(difficulty_01, 0.05), 0.95)
        return round(math.log(clamped / (1.0 - clamped)) * 1.5, 3)

    @staticmethod
    def probability_correct(
        theta: float,
        difficulty_b: float,
        discrimination_a: float = 1.0,
        guessing_c: float = 0.25,
    ) -> float:
        z = discrimination_a * (theta - difficulty_b)
        z = max(min(z, 20.0), -20.0)
        p_logistic = 1.0 / (1.0 + math.exp(-z))
        return guessing_c + (1.0 - guessing_c) * p_logistic

    @classmethod
    def estimate_student_ability(
        cls,
        responses: list,
        initial_theta: float = 0.0,
        max_iterations: int = 25,
    ) -> float:
        """responses: list of (is_correct, difficulty_01, discrimination)."""
        if not responses:
            return initial_theta

        theta = initial_theta
        for _ in range(max_iterations):
            score_sum = 0.0
            info_sum = 0.0

            for is_correct, diff_01, disc in responses:
                b = cls.difficulty_to_b_parameter(diff_01)
                a = disc if disc > 0 else 1.0
                P = cls.probability_correct(theta, b, a, guessing_c=0.20)
                u = 1.0 if is_correct else 0.0

                score_sum += a * (u - P)
                info_sum += (a**2) * P * (1.0 - P)

            if info_sum <= 1e-5:
                break

            delta = score_sum / info_sum
            delta = max(min(delta, 0.75), -0.75)
            theta += delta

            if abs(delta) < 0.01:
                break

        return round(min(max(theta, -3.0), 3.0), 3)