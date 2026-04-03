import type {
  CreateDocumentRequest,
  DeleteDocumentResponse,
  DocumentRecord,
  ListDocumentsResponse,
  UpdateDocumentRequest
} from "@collab/shared";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

type ErrorPayload = {
  error?: {
    message?: string;
  };
};

async function sendJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  const body = (await response.json().catch(() => null)) as ErrorPayload | T | null;

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? body.error?.message
        : undefined;
    throw new Error(message ?? "Request failed");
  }

  return body as T;
}

export function listDocuments(): Promise<ListDocumentsResponse> {
  return sendJson<ListDocumentsResponse>("/api/documents");
}

export function getDocument(id: string): Promise<DocumentRecord> {
  return sendJson<DocumentRecord>(`/api/documents/${id}`);
}

export function createDocument(
  input: CreateDocumentRequest
): Promise<DocumentRecord> {
  return sendJson<DocumentRecord>("/api/documents", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateDocument(
  id: string,
  input: UpdateDocumentRequest
): Promise<DocumentRecord> {
  return sendJson<DocumentRecord>(`/api/documents/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteDocument(id: string): Promise<DeleteDocumentResponse> {
  return sendJson<DeleteDocumentResponse>(`/api/documents/${id}`, {
    method: "DELETE"
  });
}
