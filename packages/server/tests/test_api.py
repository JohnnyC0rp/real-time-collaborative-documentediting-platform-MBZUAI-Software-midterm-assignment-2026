from __future__ import annotations

import json
from typing import Any

from app.ai.provider import AiProviderResponse


def auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def register_user(client, *, username: str, email: str, password: str = "password123") -> dict[str, Any]:
    response = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": password
        }
    )

    assert response.status_code == 201, response.text
    return response.json()


def parse_sse_events(response) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    current_event = "message"

    for raw_line in response.iter_lines():
        line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
        if not line:
            continue
        if line.startswith("event:"):
            current_event = line.removeprefix("event:").strip()
            continue
        if line.startswith("data:"):
            events.append(
                {
                    "event": current_event,
                    "data": json.loads(line.removeprefix("data:").strip())
                }
            )

    return events


def test_refresh_rotates_session_and_keeps_authenticated_routes_working(client_factory) -> None:
    client = client_factory()
    session = register_user(client, username="alice", email="alice@example.com")

    me_response = client.get("/api/auth/me", headers=auth_headers(session["access_token"]))
    assert me_response.status_code == 200
    assert me_response.json()["username"] == "alice"

    refresh_response = client.post("/api/auth/refresh")
    assert refresh_response.status_code == 200
    refreshed_session = refresh_response.json()
    assert refreshed_session["access_token"] != session["access_token"]

    refreshed_me = client.get("/api/auth/me", headers=auth_headers(refreshed_session["access_token"]))
    assert refreshed_me.status_code == 200
    assert refreshed_me.json()["email"] == "alice@example.com"


def test_document_crud_permissions_and_role_enforcement(client_factory) -> None:
    owner_client = client_factory()
    viewer_client = client_factory()
    editor_client = client_factory()

    owner_session = register_user(owner_client, username="owner", email="owner@example.com")
    viewer_session = register_user(viewer_client, username="viewer", email="viewer@example.com")
    editor_session = register_user(editor_client, username="editor", email="editor@example.com")

    create_response = owner_client.post(
        "/api/documents",
        headers=auth_headers(owner_session["access_token"]),
        json={"title": "Shared Notes"}
    )
    assert create_response.status_code == 201
    document = create_response.json()

    share_viewer = owner_client.post(
        f"/api/documents/{document['id']}/shares",
        headers=auth_headers(owner_session["access_token"]),
        json={"identifier": "viewer", "role": "viewer"}
    )
    assert share_viewer.status_code == 200

    share_editor = owner_client.post(
        f"/api/documents/{document['id']}/shares",
        headers=auth_headers(owner_session["access_token"]),
        json={"identifier": "editor@example.com", "role": "editor"}
    )
    assert share_editor.status_code == 200

    viewer_get = viewer_client.get(
        f"/api/documents/{document['id']}",
        headers=auth_headers(viewer_session["access_token"])
    )
    assert viewer_get.status_code == 200

    viewer_update = viewer_client.put(
        f"/api/documents/{document['id']}",
        headers=auth_headers(viewer_session["access_token"]),
        json={"content": "<p>Unauthorized edit</p>", "save_source": "manual-update"}
    )
    assert viewer_update.status_code == 403
    assert viewer_update.json()["error"]["message"] == "You cannot edit this document"

    editor_update = editor_client.put(
        f"/api/documents/{document['id']}",
        headers=auth_headers(editor_session["access_token"]),
        json={"content": "<p>Editor update</p>", "save_source": "manual-update"}
    )
    assert editor_update.status_code == 200
    assert editor_update.json()["content"] == "<p>Editor update</p>"

    owner_delete = owner_client.delete(
        f"/api/documents/{document['id']}",
        headers=auth_headers(owner_session["access_token"])
    )
    assert owner_delete.status_code == 200
    assert owner_delete.json()["success"] is True


def test_ai_action_stream_and_history_use_mock_provider(client_factory, monkeypatch) -> None:
    class FakeProvider:
        def generate(self, _generation_input) -> AiProviderResponse:
            return AiProviderResponse(text="Clearer rewritten text.", model_id="fake-model-v1")

    monkeypatch.setattr("app.routers.ai.get_ai_provider", lambda: FakeProvider())
    monkeypatch.setattr("app.routers.ai.current_model_id", lambda: "fake-model-v1")

    client = client_factory()
    session = register_user(client, username="writer", email="writer@example.com")

    create_response = client.post(
        "/api/documents",
        headers=auth_headers(session["access_token"]),
        json={"title": "Draft"}
    )
    document = create_response.json()
    requested_version_id = document["versions"][0]["id"]

    with client.stream(
        "POST",
        "/api/ai/actions",
        headers={
            **auth_headers(session["access_token"]),
            "Accept": "text/event-stream"
        },
        json={
            "document_id": document["id"],
            "action": "rewrite",
            "selection": {
                "plain_text_start": 0,
                "plain_text_end": 12,
                "tiptap_from": 1,
                "tiptap_to": 5,
                "text": "Original copy",
                "before_context": "",
                "after_context": "",
                "outline_summary": ""
            },
            "requested_document_version_id": requested_version_id,
            "instruction": "Make it clearer"
        }
    ) as response:
        assert response.status_code == 200
        events = parse_sse_events(response)

    event_names = [event["event"] for event in events]
    assert "accepted" in event_names
    assert "streaming" in event_names
    assert "complete" in event_names
    assert events[-1]["data"]["suggestion_text"] == "Clearer rewritten text."

    history_response = client.get(
        f"/api/ai/history/{document['id']}",
        headers=auth_headers(session["access_token"])
    )
    assert history_response.status_code == 200
    payload = history_response.json()
    assert payload["total"] == 1
    assert payload["interactions"][0]["model_id"] == "fake-model-v1"
