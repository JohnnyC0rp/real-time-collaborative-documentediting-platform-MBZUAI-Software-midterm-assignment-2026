from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.dependencies import get_json_store
from app.main import app
from app.routers.collaboration import hub
from app.store import JsonStore, get_store


@pytest.fixture
def store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[JsonStore]:
    data_file = tmp_path / "test-app-data.json"
    monkeypatch.setenv("DATA_FILE", str(data_file))
    get_settings.cache_clear()
    get_store.cache_clear()
    hub._rooms.clear()

    test_store = JsonStore(data_file)
    test_store.ensure_initialized()
    app.dependency_overrides[get_json_store] = lambda: test_store

    yield test_store

    app.dependency_overrides.clear()
    hub._rooms.clear()
    get_store.cache_clear()
    get_settings.cache_clear()


@pytest.fixture
def client_factory(store: JsonStore) -> Iterator[callable]:
    clients: list[TestClient] = []

    def make_client() -> TestClient:
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        return client

    yield make_client

    while clients:
        client = clients.pop()
        client.__exit__(None, None, None)
