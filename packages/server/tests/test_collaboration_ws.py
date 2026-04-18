from __future__ import annotations

from typing import Any

import pytest
from starlette.websockets import WebSocketDisconnect


def auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def register_user(client, *, username: str, email: str) -> dict[str, Any]:
    response = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": "password123"
        }
    )
    assert response.status_code == 201, response.text
    return response.json()


def receive_until_type(websocket, expected_type: str) -> dict[str, Any]:
    while True:
        message = websocket.receive_json()
        if message["type"] == expected_type:
            return message


def test_collaboration_websocket_requires_authentication(client_factory) -> None:
    client = client_factory()

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/collaboration/documents/doc-123"):
            pass


def test_collaboration_websocket_broadcasts_presence_and_updates(client_factory) -> None:
    owner_client = client_factory()
    editor_client = client_factory()

    owner_session = register_user(owner_client, username="owner", email="owner@example.com")
    editor_session = register_user(editor_client, username="editor", email="editor@example.com")

    create_response = owner_client.post(
        "/api/documents",
        headers=auth_headers(owner_session["access_token"]),
        json={"title": "Realtime Notes"}
    )
    document = create_response.json()

    share_response = owner_client.post(
        f"/api/documents/{document['id']}/shares",
        headers=auth_headers(owner_session["access_token"]),
        json={"identifier": "editor", "role": "editor"}
    )
    assert share_response.status_code == 200

    with owner_client.websocket_connect(
        f"/api/collaboration/documents/{document['id']}?token={owner_session['access_token']}"
    ) as owner_ws:
        owner_snapshot = receive_until_type(owner_ws, "snapshot")
        assert owner_snapshot["document"]["title"] == "Realtime Notes"

        with editor_client.websocket_connect(
            f"/api/collaboration/documents/{document['id']}?token={editor_session['access_token']}"
        ) as editor_ws:
            editor_snapshot = receive_until_type(editor_ws, "snapshot")
            assert editor_snapshot["document"]["id"] == document["id"]

            owner_presence = receive_until_type(owner_ws, "presence")
            if {entry["username"] for entry in owner_presence["presence"]} != {"owner", "editor"}:
                owner_presence = receive_until_type(owner_ws, "presence")
            assert {entry["username"] for entry in owner_presence["presence"]} == {"owner", "editor"}

            editor_ws.send_json(
                {
                    "type": "document.update",
                    "title": "Realtime Notes",
                    "content": "<p>Editor changed this live.</p>"
                }
            )

            editor_ack = receive_until_type(editor_ws, "ack")
            assert editor_ack["document"]["content"] == "<p>Editor changed this live.</p>"
            assert editor_ack["document"]["latest_version"]["source"] == "autosave"

            owner_update = receive_until_type(owner_ws, "document.updated")
            assert owner_update["document"]["content"] == "<p>Editor changed this live.</p>"
            assert owner_update["updated_by"]["username"] == "editor"
