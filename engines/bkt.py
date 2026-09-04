"""Engine 2 — Bayesian Knowledge Tracing (BKT).

Tracks the hidden probability P(L) that a student genuinely knows a concept,
correcting for lucky guesses (P(G)) and unlucky slips (P(S)).
"""


class BayesianKnowledgeTracing:
    def __init__(
        self,
        p_init: float = 0.20,
        p_transit: float = 0.15,
        p_guess: float = 0.25,
        p_slip: float = 0.10,
    ):
        self.p_init = p_init
        self.p_transit = p_transit
        self.p_guess = p_guess
        self.p_slip = p_slip

    def update_single_step(self, current_p_known: float, is_correct: bool) -> float:
        p = current_p_known
        if is_correct:
            numerator = p * (1.0 - self.p_slip)
            denominator = numerator + (1.0 - p) * self.p_guess
        else:
            numerator = p * self.p_slip
            denominator = numerator + (1.0 - p) * (1.0 - self.p_guess)

        p_learned = numerator / max(denominator, 1e-7)
        p_next = p_learned + (1.0 - p_learned) * self.p_transit
        return round(min(max(p_next, 0.01), 0.99), 3)

    def compute_sequence_mastery(self, response_sequence: list) -> float:
        p = self.p_init
        for is_correct in response_sequence:
            p = self.update_single_step(p, is_correct)
        return p