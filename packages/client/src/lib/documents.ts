import type {
  CreateDocumentRequest,
  DocumentDetail,
  DocumentsResponse,
  RestoreVersionRequest,
  ShareDocumentRequest,
  SuccessResponse,
  UpdateDocumentRequest
} from "@collab/shared";
import { apiFetch, extractApiErrorMessage } from "./api";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await extractApiErrorMessage(response));
  }

  return (await response.json()) as T;
}

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
