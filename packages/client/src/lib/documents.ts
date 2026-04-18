import type {
  CreateShareLinkRequest,
  DocumentAiInteraction,
  CreateDocumentRequest,
  DocumentDetail,
  GuestAccessSession,
  GuestAccessSessionRequest,
  DocumentsResponse,
  GenerateAiSuggestionRequest,
  RestoreVersionRequest,
  ShareDocumentRequest,
  SuccessResponse,
  UpdateAiInteractionStatusRequest,
  UpdateDocumentRequest
} from "@collab/shared";
import { apiFetch, extractApiErrorMessage, publicFetch } from "./api";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await extractApiErrorMessage(response));
  }

  return (await response.json()) as T;
}

export type AiStreamEvent =
  | {
      type: "start";
      interaction_id: string;
      feature: GenerateAiSuggestionRequest["feature"];
      selection_mode: DocumentAiInteraction["selection_mode"];
      original_text: string;
      model: string;
    }
  | {
      type: "chunk";
      text: string;
    }
  | {
      type: "done";
      text: string;
    }
  | {
      type: "error";
      message: string;
    };

export async function listDocuments() {
  const response = await apiFetch("/api/documents");
  return parseResponse<DocumentsResponse>(response);
}

export async function createDocument(payload: CreateDocumentRequest) {
  const response = await apiFetch("/api/documents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseResponse<DocumentDetail>(response);
}

export async function getDocument(documentId: string) {
  const response = await apiFetch(`/api/documents/${documentId}`);
  return parseResponse<DocumentDetail>(response);
}

export async function updateDocument(documentId: string, payload: UpdateDocumentRequest) {
  const response = await apiFetch(`/api/documents/${documentId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseResponse<DocumentDetail>(response);
}

export async function deleteDocument(documentId: string) {
  const response = await apiFetch(`/api/documents/${documentId}`, {
    method: "DELETE"
  });
  return parseResponse<SuccessResponse>(response);
}

export async function shareDocument(documentId: string, payload: ShareDocumentRequest) {
  const response = await apiFetch(`/api/documents/${documentId}/shares`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseResponse<DocumentDetail>(response);
}

export async function removeShare(documentId: string, shareId: string) {
  const response = await apiFetch(`/api/documents/${documentId}/shares/${shareId}`, {
    method: "DELETE"
  });
  return parseResponse<DocumentDetail>(response);
}

export async function createShareLink(documentId: string, payload: CreateShareLinkRequest) {
  const response = await apiFetch(`/api/documents/${documentId}/share-links`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseResponse<DocumentDetail>(response);
}

export async function revokeShareLink(documentId: string, shareLinkId: string) {
  const response = await apiFetch(`/api/documents/${documentId}/share-links/${shareLinkId}`, {
    method: "DELETE"
  });
  return parseResponse<DocumentDetail>(response);
}

export async function restoreVersion(documentId: string, payload: RestoreVersionRequest) {
  const response = await apiFetch(`/api/documents/${documentId}/versions/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseResponse<DocumentDetail>(response);
}

export async function streamAiSuggestion(
  documentId: string,
  payload: GenerateAiSuggestionRequest,
  options: {
    signal: AbortSignal;
    onEvent: (event: AiStreamEvent) => void;
  }
) {
  const response = await apiFetch(`/api/documents/${documentId}/ai/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error(await extractApiErrorMessage(response));
  }

  if (!response.body) {
    throw new Error("Streaming is not available in this browser");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (rawLine) {
        options.onEvent(JSON.parse(rawLine) as AiStreamEvent);
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      const lastLine = buffer.trim();
      if (lastLine) {
        options.onEvent(JSON.parse(lastLine) as AiStreamEvent);
      }
      return;
    }
  }
}

export async function updateAiInteractionStatus(
  documentId: string,
  interactionId: string,
  payload: UpdateAiInteractionStatusRequest
) {
  const response = await apiFetch(`/api/documents/${documentId}/ai/history/${interactionId}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseResponse<DocumentDetail>(response);
}

export function getOrCreateGuestKey(shareToken: string) {
  const storageKey = `guest-link:${shareToken}`;
  const existingKey = window.localStorage.getItem(storageKey);
  if (existingKey) {
    return existingKey;
  }

  // Reuse the same browser-side guest key per link so Ghost #n
  // does not respawn on every refresh like a tiny haunted bug.
  const nextKey = window.crypto.randomUUID();
  window.localStorage.setItem(storageKey, nextKey);
  return nextKey;
}

export async function createGuestAccessSession(
  shareToken: string,
  payload: GuestAccessSessionRequest
) {
  const response = await publicFetch(`/api/public/share-links/${shareToken}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseResponse<GuestAccessSession>(response);
}

export async function updateGuestDocument(
  shareToken: string,
  documentId: string,
  guestKey: string,
  payload: UpdateDocumentRequest
) {
  const response = await publicFetch(`/api/public/share-links/${shareToken}/documents/${documentId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Guest-Key": guestKey
    },
    body: JSON.stringify(payload)
  });
  return parseResponse<DocumentDetail>(response);
}
