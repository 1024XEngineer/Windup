from windup_app.server.quota.redemption import create_codes

from windup_app.server.quota.model import CreditRedemptionCode
from windup_app.server.quota.service import redemption_code_hash


def test_create_codes_returns_printable_codes_and_persists_only_hashes(db_session):
    codes = create_codes(db_session, count=3)

    assert len(codes) == 3
    assert all(code.startswith("WU-") for code in codes)
    assert len(set(codes)) == 3

    rows = db_session.query(CreditRedemptionCode).all()
    assert len(rows) == 3
    assert {row.code_hash for row in rows} == {
        redemption_code_hash(code) for code in codes
    }


def test_create_codes_skips_a_code_that_already_exists(db_session, monkeypatch):
    existing_code = "WU-ABCD-EFGH-JKLM"
    replacement_code = "WU-NPQR-STUV-WXYZ"
    db_session.add(
        CreditRedemptionCode(code_hash=redemption_code_hash(existing_code), amount=1000)
    )
    db_session.flush()
    generated = iter([existing_code, replacement_code])
    monkeypatch.setattr(
        "windup_app.server.quota.redemption._new_code", lambda: next(generated)
    )

    assert create_codes(db_session, count=1) == [replacement_code]
