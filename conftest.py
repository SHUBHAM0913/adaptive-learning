"""Pytest setup for the adaptive-learning-platform.

Every test runs against an isolated, throwaway SQLite DB (never the seeded
`adaptive.db`) by setting ADAPTIVE_DB before any app module is imported.

The env var must be in place before `database`/`main`/`seed` are imported, so
it is set here at module-import time rather than inside a fixture.
"""

import os
from pathlib import Path

TEST_DB = Path(__file__).parent / "tests" / "test_adaptive.db"
if TEST_DB.exists():
    TEST_DB.unlink()

os.environ["ADAPTIVE_DB"] = str(TEST_DB)


import pytest  # noqa: E402  (must run after the env var above)


@pytest.fixture(scope="session", autouse=True)
def seeded_curriculum():
    """Seed concepts, prerequisites and the question bank once per session."""
    from database import engine
    from seed import seed

    seed(create_demo=False)
    yield
    engine.dispose()
    if TEST_DB.exists():
        try:
            TEST_DB.unlink()
        except OSError:
            pass  # file still locked on Windows; harmless leftover


@pytest.fixture(scope="session")
def client():
    """FastAPI TestClient — exercises the real ASGI app in-process, so the
    integration tests never need a live uvicorn server (which hangs a
    foreground terminal)."""
    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as c:
        yield c
