export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "CONFLICT",
  "SERVER_ERROR"
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export type AccessRole = "owner" | "editor" | "viewer";

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  created_at: string;
}

export interface AuthSession {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: UserProfile;
}

export interface DocumentSummary {
  id: string;
  title: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  role: AccessRole;
  owner: Pick<UserProfile, "id" | "username" | "email">;
}

export interface DocumentShare {
  id: string;
  user_id: string;
  username: string;
  email: string;
  role: Exclude<AccessRole, "owner">;
  granted_at: string;
}

export interface DocumentVersion {
  id: string;
  title: string;
  content: string;
  created_at: string;
  created_by: Pick<UserProfile, "id" | "username" | "email">;
  source: "autosave" | "manual-update" | "restore" | "initial";
  restored_from_version_id: string | null;
}

export type AiFeature = "rewrite" | "summarize" | "fix_grammar";

export type AiTone = "clear" | "formal" | "friendly";

export type AiLength = "short" | "medium" | "long";

export type AiSelectionMode = "selection" | "document_excerpt";

export type AiInteractionStatus =
  | "streaming"
  | "completed"
  | "accepted"
  | "rejected"
  | "canceled"
  | "error";

export interface DocumentAiInteraction {
  id: string;
  feature: AiFeature;
  requested_at: string;
  requested_by: Pick<UserProfile, "id" | "username" | "email">;
  selection_mode: AiSelectionMode;
  tone: AiTone | null;
  output_length: AiLength | null;
  original_text: string;
  prompt_text: string;
  model: string;
  response_text: string;
  status: AiInteractionStatus;
  error_message: string | null;
  decided_at: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  content: string;
  shares: DocumentShare[];
  versions: DocumentVersion[];
  ai_history: DocumentAiInteraction[];
}

export interface DocumentsResponse {
  documents: DocumentSummary[];
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface CreateDocumentRequest {
  title: string;
}

export interface UpdateDocumentRequest {
  title?: string;
  content?: string;
  save_source?: "autosave" | "manual-update";
}

export interface ShareDocumentRequest {
  identifier: string;
  role: Exclude<AccessRole, "owner">;
}

export interface UpdateShareRequest {
  role: Exclude<AccessRole, "owner">;
}

export interface RestoreVersionRequest {
  version_id: string;
}

export interface GenerateAiSuggestionRequest {
  feature: AiFeature;
  document_content: string;
  selected_text?: string | null;
  tone?: AiTone | null;
  output_length?: AiLength | null;
  base_updated_at: string;
}

export interface UpdateAiInteractionStatusRequest {
  status: Extract<AiInteractionStatus, "accepted" | "rejected">;
}

export interface SuccessResponse {
  success: true;
}

export const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return uuidRegex.test(value);
}
