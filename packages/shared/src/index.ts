export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "CONFLICT",
  "SERVER_ERROR",
  "POLICY_BLOCKED",
  "QUOTA_EXCEEDED"
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export type AccessRole = "owner" | "editor" | "viewer";

export const AI_ACTION_TYPES = ["rewrite", "summarize", "translate", "restructure"] as const;
export type AiActionType = (typeof AI_ACTION_TYPES)[number];

export const AI_INTERACTION_STAGES = [
  "accepted",
  "complete",
  "stale",
  "failed"
] as const;
export type AiInteractionStage = (typeof AI_INTERACTION_STAGES)[number];

export const AI_INTERACTION_RESOLUTIONS = [
  "pending-review",
  "accepted",
  "edited-before-apply",
  "rejected",
  "expired",
  "failed"
] as const;
export type AiInteractionResolution = (typeof AI_INTERACTION_RESOLUTIONS)[number];

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

export interface DocumentDetail extends DocumentSummary {
  content: string;
  shares: DocumentShare[];
  versions: DocumentVersion[];
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

export interface SuccessResponse {
  success: true;
}

export interface AiSelectionPayload {
  plain_text_start: number;
  plain_text_end: number;
  tiptap_from: number;
  tiptap_to: number;
  text: string;
  before_context: string;
  after_context: string;
  outline_summary: string;
}

export interface SubmitAiActionRequest {
  document_id: string;
  action: AiActionType;
  selection: AiSelectionPayload;
  requested_document_version_id: string;
  target_language?: string;
  instruction?: string;
}

export interface AiActionAcceptedEvent {
  interaction_id: string;
  action: AiActionType;
  requested_at: string;
  model_id: string;
}

export interface AiActionStreamingEvent {
  interaction_id: string;
  delta: string;
  accumulated_text: string;
}

export interface AiActionResult {
  interaction_id: string;
  document_id: string;
  action: AiActionType;
  stage: Extract<AiInteractionStage, "complete" | "stale">;
  resolution: Extract<AiInteractionResolution, "pending-review">;
  requested_at: string;
  completed_at: string;
  model_id: string;
  original_text: string;
  suggestion_text: string;
  requested_document_version_id: string;
  current_document_version_id: string;
  target_language: string | null;
  instruction: string | null;
  selection: Pick<
    AiSelectionPayload,
    "plain_text_start" | "plain_text_end" | "tiptap_from" | "tiptap_to"
  >;
}

export interface AiInteractionRecord {
  id: string;
  document_id: string;
  action: AiActionType;
  stage: AiInteractionStage;
  resolution: AiInteractionResolution;
  requested_at: string;
  completed_at: string | null;
  resolved_at: string | null;
  updated_at: string;
  requested_by: Pick<UserProfile, "id" | "username" | "email">;
  model_id: string;
  target_language: string | null;
  instruction: string | null;
  requested_document_version_id: string;
  current_document_version_id: string | null;
  applied_document_version_id: string | null;
  selection_plain_text_start: number;
  selection_plain_text_end: number;
  selection_text_preview: string;
  suggestion_preview: string | null;
  error_code: ApiErrorCode | null;
}

export interface AiHistoryResponse {
  interactions: AiInteractionRecord[];
  total: number;
}

export interface ResolveAiInteractionRequest {
  resolution: Extract<
    AiInteractionResolution,
    "accepted" | "edited-before-apply" | "rejected"
  >;
  applied_document_version_id?: string;
  final_text?: string;
}

export const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return uuidRegex.test(value);
}
