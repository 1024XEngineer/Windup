"""Export the FastAPI OpenAPI schema to the repository root."""

from __future__ import annotations

import json
import os
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "openapi-export-only-secret-32chars")
os.environ.setdefault("POSTGRES_PASSWORD", "openapi-export-only-password")

from windup_app.bootstrap.app import create_app


OPENAPI_PATH = Path(__file__).resolve().parents[2] / "openapi.json"


def main() -> None:
    app = create_app()
    try:
        schema = app.openapi()
    finally:
        app.state.generation_dispatcher.shutdown()

    OPENAPI_PATH.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
