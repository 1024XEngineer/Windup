"""生成一次性积分兑换码并把明文输出给运营人员。"""

from __future__ import annotations

import argparse
from datetime import datetime

from windup_app.server.quota.redemption import create_codes
from windup_app.server.quota.model import CreditRedemptionCode
from windup_framework.db import Base, SessionLocal, engine


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, required=True)
    parser.add_argument("--expires-at", type=datetime.fromisoformat)
    args = parser.parse_args()

    Base.metadata.create_all(engine, tables=[CreditRedemptionCode.__table__])
    with SessionLocal.begin() as session:
        for code in create_codes(session, count=args.count, expires_at=args.expires_at):
            print(code)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
