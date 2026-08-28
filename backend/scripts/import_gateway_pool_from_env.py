"""把 ``AI_ROUTE_*`` env 灌进凭证池四表（幂等）。"""

from __future__ import annotations

import argparse
import sys

from windup_framework.config.provider import settings as ai_settings
from windup_framework.db import SessionLocal
from windup_framework.gateway.pool_ids import credential_id, default_account_id
from windup_framework.gateway.pool_models import (
    POOL_STATUS_ACTIVE,
    QUOTA_SCOPE_CREDENTIAL,
    GatewayPoolAccount,
    GatewayPoolCredential,
    GatewayPoolCredentialEndpoint,
    GatewayPoolEndpoint,
)
from windup_framework.gateway.pool_registry import invalidate_pool_cache
from windup_framework.gateway.routes import routes_from_settings
from windup_framework.gateway.types import Scene


def _route_groups() -> tuple[str, ...]:
    return (
        Scene.CHARACTER_ACTION.value,
        Scene.CHARACTER_IMAGE.value,
        Scene.CHAT.value,
    )


def import_from_env(*, dry_run: bool = False) -> int:
    cfg = ai_settings
    created = 0
    with SessionLocal() as session:
        seen_endpoints: set[str] = set()
        seen_accounts: set[str] = set()
        seen_credentials: set[str] = set()

        for route_group in _route_groups():
            routes = routes_from_settings(cfg, route_group=route_group)
            for index, route in enumerate(routes):
                endpoint_id = route.base_url_id
                cred = credential_id(endpoint_id, route.api_key)
                acct_id = default_account_id(cred)

                if endpoint_id not in seen_endpoints:
                    if session.get(GatewayPoolEndpoint, endpoint_id) is None:
                        if not dry_run:
                            session.add(
                                GatewayPoolEndpoint(
                                    endpoint_id=endpoint_id,
                                    display_name=endpoint_id,
                                    base_url=route.base_url,
                                    provider_name=route.provider_name,
                                    status=POOL_STATUS_ACTIVE,
                                )
                            )
                        created += 1
                    seen_endpoints.add(endpoint_id)

                if acct_id not in seen_accounts:
                    if session.get(GatewayPoolAccount, acct_id) is None:
                        if not dry_run:
                            session.add(
                                GatewayPoolAccount(
                                    account_id=acct_id,
                                    display_name=acct_id,
                                    quota_scope=QUOTA_SCOPE_CREDENTIAL,
                                    inflight_max=2,
                                    status=POOL_STATUS_ACTIVE,
                                )
                            )
                        created += 1
                    seen_accounts.add(acct_id)

                if cred not in seen_credentials:
                    if session.get(GatewayPoolCredential, cred) is None:
                        hint = route.api_key[-4:] if len(route.api_key) >= 4 else "****"
                        if not dry_run:
                            session.add(
                                GatewayPoolCredential(
                                    credential_id=cred,
                                    account_id=acct_id,
                                    api_key_ciphertext=f"plaintext:{route.api_key}",
                                    api_key_hint=hint,
                                    status=POOL_STATUS_ACTIVE,
                                )
                            )
                        created += 1
                    seen_credentials.add(cred)

                binding = (
                    session.query(GatewayPoolCredentialEndpoint)
                    .filter_by(
                        credential_id=cred,
                        endpoint_id=endpoint_id,
                        route_group=route_group,
                    )
                    .first()
                )
                if binding is None:
                    if not dry_run:
                        session.add(
                            GatewayPoolCredentialEndpoint(
                                credential_id=cred,
                                endpoint_id=endpoint_id,
                                route_group=route_group,
                                priority=index,
                                status=POOL_STATUS_ACTIVE,
                            )
                        )
                    created += 1

        if not dry_run:
            session.commit()
            invalidate_pool_cache()

    return created


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import AI_ROUTE_* into gateway pool tables.")
    parser.add_argument("--dry-run", action="store_true", help="Count rows only, do not write.")
    args = parser.parse_args(argv)
    n = import_from_env(dry_run=args.dry_run)
    print(f"gateway pool import: {n} row(s) {'would be ' if args.dry_run else ''}created")
    return 0


if __name__ == "__main__":
    sys.exit(main())
