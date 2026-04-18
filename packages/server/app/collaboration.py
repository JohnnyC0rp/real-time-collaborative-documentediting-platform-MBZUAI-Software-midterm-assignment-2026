from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import WebSocket


@dataclass
class RoomConnection:
    id: str
    websocket: WebSocket
    user_id: str
    username: str
    email: str
    role: str
    last_active_at: str


class CollaborationHub:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, RoomConnection]] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        *,
        document_id: str,
        websocket: WebSocket,
        user: dict[str, Any],
        role: str,
        connected_at: str
    ) -> RoomConnection:
        connection = RoomConnection(
            id=str(uuid4()),
            websocket=websocket,
            user_id=user["id"],
            username=user["username"],
            email=user["email"],
            role=role,
            last_active_at=connected_at
        )
        async with self._lock:
            room = self._rooms.setdefault(document_id, {})
            room[connection.id] = connection
        return connection

    async def disconnect(self, document_id: str, connection_id: str) -> None:
        async with self._lock:
            room = self._rooms.get(document_id)
            if room is None:
                return

            room.pop(connection_id, None)
            if not room:
                self._rooms.pop(document_id, None)

    async def touch(self, document_id: str, connection_id: str, active_at: str) -> None:
        async with self._lock:
            room = self._rooms.get(document_id)
            if room is None or connection_id not in room:
                return

            room[connection_id].last_active_at = active_at

    async def presence_for_document(self, document_id: str) -> list[dict[str, str]]:
        async with self._lock:
            room = self._rooms.get(document_id, {})
            return [
                {
                    "user_id": connection.user_id,
                    "username": connection.username,
                    "role": connection.role,
                    "last_active_at": connection.last_active_at
                }
                for connection in room.values()
            ]

    async def broadcast(
        self,
        *,
        document_id: str,
        payload: dict[str, Any],
        exclude_connection_id: str | None = None
    ) -> None:
        async with self._lock:
            room = list(self._rooms.get(document_id, {}).values())

        stale_connections: list[str] = []
        for connection in room:
            if exclude_connection_id and connection.id == exclude_connection_id:
                continue

            try:
                await connection.websocket.send_json(payload)
            except Exception:
                stale_connections.append(connection.id)

        for connection_id in stale_connections:
            await self.disconnect(document_id, connection_id)

    async def send_presence(self, document_id: str) -> None:
        presence = await self.presence_for_document(document_id)
        await self.broadcast(
            document_id=document_id,
            payload={
                "type": "presence",
                "presence": presence
            }
        )


def is_recently_active(iso_timestamp: str, *, seconds: int = 5) -> bool:
    return datetime.fromisoformat(iso_timestamp) >= datetime.now(UTC) - timedelta(seconds=seconds)
