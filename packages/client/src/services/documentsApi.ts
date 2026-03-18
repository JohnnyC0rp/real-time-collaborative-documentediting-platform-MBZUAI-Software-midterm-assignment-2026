import type {
  CreateDocumentRequest,
  DeleteDocumentResponse,
  DocumentRecord,
  ListDocumentsResponse,
  UpdateDocumentRequest
} from "@collab/shared";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Request failed");
  }

  return payload as T;
}

export function listDocuments(): Promise<ListDocumentsResponse> {
  return request<ListDocumentsResponse>("/api/documents");
}

export function getDocument(id: string): Promise<DocumentRecord> {
  return request<DocumentRecord>(`/api/documents/${id}`);
}

export function createDocument(
  input: CreateDocumentRequest
): Promise<DocumentRecord> {
  return request<DocumentRecord>("/api/documents", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateDocument(
  id: string,
  input: UpdateDocumentRequest
): Promise<DocumentRecord> {
  return request<DocumentRecord>(`/api/documents/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteDocument(id: string): Promise<DeleteDocumentResponse> {
  return request<DeleteDocumentResponse>(`/api/documents/${id}`, {
    method: "DELETE"
  });
}
