from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.billing import billing_flags, upstream_reached_label
from windup_framework.gateway.budget import AttemptBudget
from windup_framework.gateway.types import NextStep


def test_billing_flags_unreached_not_billed():
    assert billing_flags(error_type=ModelErrorType.UNREACHED, http_status=525) is False
    assert billing_flags(error_type=ModelErrorType.UNREACHED, http_status=502) is False


def test_billing_flags_maybe_billed_and_timeout():
    assert billing_flags(error_type=ModelErrorType.MAYBE_BILLED, http_status=520) is True
    assert billing_flags(error_type=ModelErrorType.TIMEOUT, http_status=None) is True


def test_billing_flags_success():
    assert billing_flags(error_type=None, ok=True) is True


def test_attempt_budget_tier_b_escalation_order():
    budget = AttemptBudget()
    step = budget.tier_b_escalation(
        ModelErrorType.MAYBE_BILLED,
        has_next_route=True,
        has_job_id=False,
    )
    assert step is NextStep.OPEN_AGGREGATOR
    step = budget.tier_b_escalation(
        ModelErrorType.MAYBE_BILLED,
        has_next_route=False,
        has_job_id=False,
    )
    assert step is NextStep.FALLBACK


def test_upstream_reached_labels():
    assert upstream_reached_label(ModelErrorType.UNREACHED, http_status=525) == "false"
    assert upstream_reached_label(None, ok=True) == "true"
