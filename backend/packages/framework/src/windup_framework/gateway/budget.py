from __future__ import annotations

from dataclasses import dataclass, field

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.types import NextStep

_TIER_B = frozenset({ModelErrorType.MAYBE_BILLED, ModelErrorType.TIMEOUT})


@dataclass
class AttemptBudget:
    max_attempts: int = 4
    max_maybe_billed: int = 2
    max_tier_b_route_switches: int = 1
    max_tier_b_model_switches: int = 1

    attempts_used: int = field(default=0, init=False)
    maybe_billed_used: int = field(default=0, init=False)
    tier_b_route_switches: int = field(default=0, init=False)
    tier_b_model_switches: int = field(default=0, init=False)

    def can_record(self, maybe_billed: bool) -> bool:
        if self.attempts_used >= self.max_attempts:
            return False
        if maybe_billed and self.maybe_billed_used >= self.max_maybe_billed:
            return False
        return True

    def record(self, maybe_billed: bool) -> None:
        self.attempts_used += 1
        if maybe_billed:
            self.maybe_billed_used += 1

    def exhausted(self) -> bool:
        return self.attempts_used >= self.max_attempts

    def tier_b_escalation(
        self,
        error_type: ModelErrorType,
        *,
        has_next_route: bool,
        has_job_id: bool,
    ) -> NextStep | None:
        if has_job_id or error_type not in _TIER_B:
            return None
        if has_next_route and self.tier_b_route_switches < self.max_tier_b_route_switches:
            self.tier_b_route_switches += 1
            return NextStep.OPEN_AGGREGATOR
        if self.tier_b_model_switches < self.max_tier_b_model_switches:
            self.tier_b_model_switches += 1
            return NextStep.FALLBACK
        return None
