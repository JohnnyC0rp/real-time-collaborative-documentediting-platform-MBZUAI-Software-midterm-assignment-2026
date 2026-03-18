export const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "SERVER_ERROR"
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export interface DocumentRecord {
  id: string;
  title: string;
  owner_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ListDocumentsResponse {
  documents: DocumentRecord[];
  total: number;
}

export interface CreateDocumentRequest {
  title: string;
}

export interface UpdateDocumentRequest {
  title?: string;
  content?: string;
}

export interface DeleteDocumentResponse {
  success: true;
}

export const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return uuidRegex.test(value);
}
