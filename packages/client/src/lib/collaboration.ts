import type {
  CollaborationAckEvent,
  CollaborationConnectionState,
  CollaborationDocumentUpdateMessage,
  CollaborationPresenceEvent,
  CollaborationServerEvent,
  CollaborationSnapshotEvent
} from "@collab/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

interface CollaborationCallbacks {
  onAck?: (event: CollaborationAckEvent) => void;
  onConnectionStateChange?: (state: CollaborationConnectionState) => void;
  onError?: (message: string) => void;
  onPresence?: (event: CollaborationPresenceEvent) => void;
  onRemoteUpdate?: (event: Extract<CollaborationServerEvent, { type: "document.updated" }>) => void;
  onSnapshot?: (event: CollaborationSnapshotEvent) => void;
}

function collaborationUrl(documentId: string, accessToken: string) {
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/collaboration/documents/${documentId}`;
  url.searchParams.set("token", accessToken);
  return url.toString();
}

export class DocumentCollaborationSession {
  private callbacks: CollaborationCallbacks;
  private closed = false;
  private documentId: string;
  private accessToken: string;
  private reconnectAttempt = 0;
  private reconnectTimeoutId: number | null = null;
  private socket: WebSocket | null = null;
  private pendingUpdate: CollaborationDocumentUpdateMessage | null = null;

  constructor(documentId: string, accessToken: string, callbacks: CollaborationCallbacks) {
    this.documentId = documentId;
    this.accessToken = accessToken;
    this.callbacks = callbacks;
  }

  connect() {
    this.updateConnectionState(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    this.socket = new WebSocket(collaborationUrl(this.documentId, this.accessToken));
    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.updateConnectionState("connected");
      this.sendActivity();
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as CollaborationServerEvent;
      if (message.type === "snapshot") {
        this.callbacks.onSnapshot?.(message);
        this.flushPendingUpdate();
        return;
      }
      if (message.type === "presence") {
        this.callbacks.onPresence?.(message);
        return;
      }
      if (message.type === "document.updated") {
        this.callbacks.onRemoteUpdate?.(message);
        return;
      }
      if (message.type === "ack") {
        if (
          this.pendingUpdate &&
          this.pendingUpdate.title === message.document.title &&
          this.pendingUpdate.content === message.document.content
        ) {
          this.pendingUpdate = null;
        }
        this.callbacks.onAck?.(message);
        return;
      }
      if (message.type === "error") {
        this.callbacks.onError?.(message.message);
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      if (this.closed) {
        this.updateConnectionState("disconnected");
        return;
      }
      this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => {
      this.callbacks.onError?.("Live collaboration connection failed");
    });
  }

  close() {
    this.closed = true;
    if (this.reconnectTimeoutId !== null) {
      window.clearTimeout(this.reconnectTimeoutId);
    }
    this.socket?.close();
    this.socket = null;
    this.updateConnectionState("disconnected");
  }

  sendActivity() {
    this.sendMessage({ type: "activity" });
  }

  sendUpdate(update: Omit<CollaborationDocumentUpdateMessage, "type">) {
    this.pendingUpdate = {
      type: "document.update",
      ...update
    };
    this.flushPendingUpdate();
  }

  private flushPendingUpdate() {
    if (!this.pendingUpdate || this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(this.pendingUpdate));
  }

  private scheduleReconnect() {
    this.updateConnectionState("reconnecting");
    const delay = Math.min(5000, 500 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimeoutId = window.setTimeout(() => {
      this.reconnectTimeoutId = null;
      if (!this.closed) {
        this.connect();
      }
    }, delay);
  }

  private sendMessage(message: { type: "activity" | "ping" }) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }

  private updateConnectionState(state: CollaborationConnectionState) {
    this.callbacks.onConnectionStateChange?.(state);
  }
}
