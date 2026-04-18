import type {
  AiActionResult,
  AiActionType,
  AiInteractionRecord,
  CollaborationConnectionState,
  CollaborationDocumentState,
  CollaborationPresence,
  DocumentDetail,
  GuestAccessSession,
  SubmitAiActionRequest
} from "@collab/shared";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CollaborationPanel } from "../components/CollaborationPanel";
import { RichTextToolbar } from "../components/RichTextToolbar";
import { RoleBadge } from "../components/RoleBadge";
import { ShareAccessPanel } from "../components/ShareAccessPanel";
import { useAuth } from "../context/AuthContext";
import { listAiHistory, resolveAiInteraction, streamAiAction } from "../lib/ai";
import { DocumentCollaborationSession } from "../lib/collaboration";
import {
  createGuestAccessSession,
  createShareLink,
  deleteDocument,
  getDocument,
  getOrCreateGuestKey,
  removeShare,
  revokeShareLink,
  restoreVersion,
  shareDocument,
  updateGuestDocument,
  updateDocument
} from "../lib/documents";
import { pushRemotePresence, RemotePresenceExtension } from "../lib/remotePresence";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function formatEstimatedCost(value: number | null) {
  if (value === null) {
    return "n/a";
  }
  return `$${value.toFixed(6)}`;
}

function formatTokenCount(value: number | null) {
  if (value === null) {
    return "n/a";
  }
  return value.toLocaleString();
}

function describeVersionSource(source: DocumentDetail["versions"][number]["source"]) {
  switch (source) {
    case "autosave":
      return "Autosave";
    case "manual-update":
      return "Manual save";
    case "restore":
      return "Restore";
    case "initial":
      return "Initial version";
    default:
      return source;
  }
}

function describeAiAction(action: AiActionType) {
  switch (action) {
    case "rewrite":
      return "Rewrite";
    case "summarize":
      return "Summarize";
    case "translate":
      return "Translate";
    case "restructure":
      return "Restructure";
    default:
      return action;
  }
}

function describeAiResolution(record: AiInteractionRecord) {
  if (record.resolution === "pending-review") {
    if (record.stage === "stale") {
      return "Stale review";
    }
    if (record.stage === "accepted") {
      return "In flight";
    }
    return "Ready for review";
  }

  switch (record.resolution) {
    case "accepted":
      return "Accepted";
    case "edited-before-apply":
      return "Edited before apply";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "failed":
      return "Failed";
    default:
      return record.resolution;
  }
}

function buildDefaultSegmentIndexes(length: number) {
  return Array.from({ length }, (_, index) => index);
}

function splitSuggestionSegments(value: string) {
  return value
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToHtml(value: string) {
  const blocks = value
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return "<p></p>";
  }

  return blocks
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trimEnd());
      if (lines.every((line) => line.startsWith("- "))) {
        return `<ul>${lines
          .map((line) => `<li>${escapeHtml(line.slice(2))}</li>`)
          .join("")}</ul>`;
      }

      if (
        lines.length > 1 &&
        lines[0].length <= 72 &&
        !/[.!?]$/.test(lines[0])
      ) {
        return `<h2>${escapeHtml(lines[0])}</h2><p>${lines
          .slice(1)
          .map(escapeHtml)
          .join("<br>")}</p>`;
      }

      return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
    })
    .join("");
}

function collectOutlineSummary(editor: Editor, selectionFrom: number) {
  const headings: Array<{ level: number; pos: number; text: string }> = [];

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.textContent.trim()) {
      headings.push({
        level: Number(node.attrs.level ?? 1),
        pos,
        text: node.textContent.trim()
      });
    }
    return true;
  });

  if (headings.length === 0) {
    return "";
  }

  let anchorIndex = 0;
  for (let index = 0; index < headings.length; index += 1) {
    if (headings[index].pos <= selectionFrom) {
      anchorIndex = index;
    }
  }

  const startIndex = Math.max(0, anchorIndex - 2);
  const endIndex = Math.min(headings.length, startIndex + 5);
  return headings
    .slice(startIndex, endIndex)
    .map((heading) => `${"#".repeat(Math.min(heading.level, 3))} ${heading.text}`)
    .join("\n");
}

function getSelectionPayload(editor: Editor): SubmitAiActionRequest["selection"] | null {
  const { from, to } = editor.state.selection;
  if (from === to) {
    return null;
  }

  const plainTextBefore = editor.state.doc.textBetween(0, from, "\n\n");
  const selectedText = editor.state.doc.textBetween(from, to, "\n\n").trim();
  const plainTextAfter = editor.state.doc.textBetween(to, editor.state.doc.content.size, "\n\n");

  if (!selectedText) {
    return null;
  }

  return {
    plain_text_start: plainTextBefore.length,
    plain_text_end: plainTextBefore.length + selectedText.length,
    tiptap_from: from,
    tiptap_to: to,
    text: selectedText,
    before_context: plainTextBefore.slice(-1000),
    after_context: plainTextAfter.slice(0, 1000),
    outline_summary: collectOutlineSummary(editor, from)
  };
}

function getCurrentReviewText(editor: Editor, review: AiActionResult | null) {
  if (!review) {
    return "";
  }

  const plainText = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n\n");
  const excerpt = plainText.slice(
    review.selection.plain_text_start,
    review.selection.plain_text_end
  );

  if (excerpt.trim()) {
    return excerpt;
  }

  const start = Math.max(0, review.selection.plain_text_start - 80);
  const end = Math.min(plainText.length, review.selection.plain_text_end + 80);
  return plainText.slice(start, end).trim();
}

function documentSnapshot(title: string, content: string) {
  return JSON.stringify({
    title: title.trim(),
    content
  });
}

function selectionPreview(value: string) {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }
  return collapsed.length <= 72 ? collapsed : `${collapsed.slice(0, 71).trimEnd()}…`;
}

function buildSelectionPresence(editor: Editor) {
  const { from, to } = editor.state.selection;
  return {
    selection_from: from,
    selection_to: to,
    selection_preview: selectionPreview(editor.state.doc.textBetween(from, to, " "))
  };
}

function mergeLatestVersion(
  versions: DocumentDetail["versions"],
  latestVersion: CollaborationDocumentState["latest_version"]
) {
  if (!latestVersion) {
    return versions;
  }

  if (versions.some((version) => version.id === latestVersion.id)) {
    return versions;
  }

  return [latestVersion, ...versions];
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function DocumentPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { documentId = "" } = useParams();
  const shareToken = new URLSearchParams(location.search).get("token")?.trim() ?? "";
  const isGuestAccess = location.pathname.startsWith("/shared/");
  const guestKey = isGuestAccess && shareToken ? getOrCreateGuestKey(shareToken) : null;
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [guestSession, setGuestSession] = useState<GuestAccessSession | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("<p></p>");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState("Loading document...");
  const [shareIdentifier, setShareIdentifier] = useState("");
  const [shareRole, setShareRole] = useState<"editor" | "viewer">("viewer");
  const [isSharing, setIsSharing] = useState(false);
  const [creatingShareLinkRole, setCreatingShareLinkRole] = useState<"editor" | "viewer" | null>(null);
  const [shareLinkStatusMessage, setShareLinkStatusMessage] = useState("");
  const [revokingShareLinkId, setRevokingShareLinkId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [hasTextSelection, setHasTextSelection] = useState(false);
  const [aiAction, setAiAction] = useState<AiActionType>("rewrite");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiTargetLanguage, setAiTargetLanguage] = useState("English");
  const [isAiSubmitting, setIsAiSubmitting] = useState(false);
  const [isAiResolving, setIsAiResolving] = useState(false);
  const [aiStatusMessage, setAiStatusMessage] = useState("Select text to request AI help.");
  const [aiStreamText, setAiStreamText] = useState("");
  const [aiReview, setAiReview] = useState<AiActionResult | null>(null);
  const [proposalDraft, setProposalDraft] = useState("");
  const [selectedSegments, setSelectedSegments] = useState<number[]>([]);
  const [undoAiContent, setUndoAiContent] = useState<string | null>(null);
  const [didUndoAiApply, setDidUndoAiApply] = useState(false);
  const [aiHistory, setAiHistory] = useState<AiInteractionRecord[]>([]);
  const [isAiHistoryLoading, setIsAiHistoryLoading] = useState(false);
  const [aiHistoryActionFilter, setAiHistoryActionFilter] = useState("all");
  const [aiHistoryResolutionFilter, setAiHistoryResolutionFilter] = useState("all");
  const [aiHistoryRefreshToken, setAiHistoryRefreshToken] = useState(0);
  const [collaborationState, setCollaborationState] = useState<CollaborationConnectionState>("disconnected");
  const [collaborationPresence, setCollaborationPresence] = useState<CollaborationPresence[]>([]);
  const lastSavedSnapshot = useRef("");
  const lastCollaborationSnapshot = useRef<string | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  const aiStreamTextRef = useRef("");
  const collaborationSessionRef = useRef<DocumentCollaborationSession | null>(null);
  const collaborationPresenceRef = useRef<CollaborationPresence[]>([]);
  const currentTitleRef = useRef(title);
  const currentContentRef = useRef(content);
  const currentUserIdRef = useRef<string | null>(null);
  const canEditRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const lastSyncedVersionIdRef = useRef<string | null>(null);
  const lastSyncedTitleRef = useRef("");
  const lastSyncedContentRef = useRef("<p></p>");

  const editor = useEditor({
    extensions: [
      StarterKit,
      RemotePresenceExtension.configure({
        getCurrentUserId: () => currentUserIdRef.current,
        getPresence: () => collaborationPresenceRef.current
      })
    ],
    content: "<p></p>",
    editable: false,
    immediatelyRender: false,
    onUpdate({ editor: currentEditor }) {
      setContent(currentEditor.getHTML());
    },
    onSelectionUpdate({ editor: currentEditor }) {
      setHasTextSelection(currentEditor.state.selection.from !== currentEditor.state.selection.to);
      collaborationSessionRef.current?.sendActivity(buildSelectionPresence(currentEditor));
    }
  });

  const canEdit = guestSession
    ? guestSession.role === "editor"
    : document
      ? document.role === "owner" || document.role === "editor"
      : false;
  const canManageShares = !guestSession && document?.role === "owner";
  const canViewAiHistory = !guestSession && document?.role === "owner";
  const canRestoreVersions = !guestSession && canEdit;
  const canUseAi = Boolean(document && canEdit && !guestSession);
  const suggestionSegments = splitSuggestionSegments(proposalDraft);
  const selectedSuggestionText = suggestionSegments
    .filter((_, index) => selectedSegments.includes(index))
    .join("\n\n")
    .trim();
  const currentReviewText = editor ? getCurrentReviewText(editor, aiReview) : "";
  const currentUserId = guestSession?.actor.id ?? auth.user?.id ?? null;

  function applyCollaborationDocumentState(nextState: CollaborationDocumentState, saveMessage: string) {
    setDocument((currentDocument) =>
      currentDocument
        ? {
            ...currentDocument,
            title: nextState.title,
            content: nextState.content,
            updated_at: nextState.updated_at,
            versions: mergeLatestVersion(currentDocument.versions, nextState.latest_version)
          }
        : currentDocument
    );
    setTitle(nextState.title);
    setContent(nextState.content);
    lastSavedSnapshot.current = documentSnapshot(nextState.title, nextState.content);
    lastCollaborationSnapshot.current = lastSavedSnapshot.current;
    lastSyncedVersionIdRef.current = nextState.version_id;
    lastSyncedTitleRef.current = nextState.title;
    lastSyncedContentRef.current = nextState.content;
    setSaveStatus(saveMessage);
    const liveEditor = editorRef.current;
    if (liveEditor && liveEditor.getHTML() !== nextState.content) {
      liveEditor.commands.setContent(nextState.content, false);
    }
  }

  function applyDocument(nextDocument: DocumentDetail) {
    const latestVersionId = nextDocument.versions[0]?.id ?? null;
    setDocument(nextDocument);
    setTitle(nextDocument.title);
    setContent(nextDocument.content);
    lastSavedSnapshot.current = documentSnapshot(nextDocument.title, nextDocument.content);
    lastCollaborationSnapshot.current = lastSavedSnapshot.current;
    lastSyncedVersionIdRef.current = latestVersionId;
    lastSyncedTitleRef.current = nextDocument.title;
    lastSyncedContentRef.current = nextDocument.content;
    setSaveStatus(`Saved at ${formatTimestamp(nextDocument.updated_at)}`);
    if (editor && editor.getHTML() !== nextDocument.content) {
      editor.commands.setContent(nextDocument.content, false);
      setHasTextSelection(editor.state.selection.from !== editor.state.selection.to);
    }

    setPreviewVersionId((currentPreviewVersionId) => {
      if (
        currentPreviewVersionId &&
        nextDocument.versions.some((version) => version.id === currentPreviewVersionId)
      ) {
        return currentPreviewVersionId;
      }

      return nextDocument.versions[0]?.id ?? null;
    });
  }

  useEffect(() => {
    currentTitleRef.current = title;
    currentContentRef.current = content;
    currentUserIdRef.current = currentUserId;
    canEditRef.current = canEdit;
    editorRef.current = editor;
  }, [canEdit, content, currentUserId, editor, title]);

  useEffect(() => {
    collaborationPresenceRef.current = collaborationPresence;
    pushRemotePresence(editor ?? null, collaborationPresence);
  }, [collaborationPresence, editor]);

  useEffect(() => {
    let isMounted = true;

    async function loadDocument() {
      try {
        if (isGuestAccess) {
          if (!shareToken || !guestKey) {
            throw new Error("Share link is missing a valid guest token");
          }

          const nextGuestSession = await createGuestAccessSession(shareToken, {
            guest_key: guestKey
          });
          if (nextGuestSession.document.id !== documentId) {
            throw new Error("This share link does not belong to the requested document");
          }
          if (isMounted) {
            setGuestSession(nextGuestSession);
            applyDocument(nextGuestSession.document);
            setSaveStatus(`Opened shared document as ${nextGuestSession.actor.username}`);
          }
          return;
        }

        const nextDocument = await getDocument(documentId);
        if (isMounted) {
          setGuestSession(null);
          applyDocument(nextDocument);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load document");
          setSaveStatus("Unable to load document");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    if (documentId) {
      void loadDocument();
    }

    return () => {
      isMounted = false;
    };
  }, [documentId, guestKey, isGuestAccess, shareToken]);

  useEffect(() => {
    return () => {
      aiAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setEditable(canEdit);
    setHasTextSelection(editor.state.selection.from !== editor.state.selection.to);
    if (document && editor.getHTML() !== document.content) {
      editor.commands.setContent(document.content, false);
    }
  }, [canEdit, document?.id, editor]);

  useEffect(() => {
    const collaborationAuth =
      guestSession && shareToken && guestKey
        ? {
            kind: "guest" as const,
            shareToken,
            guestKey
          }
        : auth.accessToken
          ? {
              kind: "user" as const,
              accessToken: auth.accessToken
            }
          : null;

    if (!document || !collaborationAuth) {
      setCollaborationPresence([]);
      setCollaborationState("disconnected");
      collaborationSessionRef.current?.close();
      collaborationSessionRef.current = null;
      return;
    }

    const session = new DocumentCollaborationSession(document.id, collaborationAuth, {
      onAck: (event) => {
        applyCollaborationDocumentState(
          event.document,
          event.document.merge_strategy === "char-merge"
            ? `Live merged at ${formatTimestamp(event.document.updated_at)}`
            : `Live synced at ${formatTimestamp(event.document.updated_at)}`
        );
      },
      onConnectionStateChange: setCollaborationState,
      onError: (message) => {
        setErrorMessage(message);
      },
      onPresence: (event) => {
        setCollaborationPresence(event.presence);
      },
      onRemoteUpdate: (event) => {
        const liveEditor = editorRef.current;
        const currentSnapshot = documentSnapshot(
          currentTitleRef.current,
          liveEditor?.getHTML() ?? currentContentRef.current
        );
        const hasUnsyncedLocalEdits =
          canEditRef.current &&
          lastCollaborationSnapshot.current !== null &&
          currentSnapshot !== lastCollaborationSnapshot.current;

        if (hasUnsyncedLocalEdits) {
          setSaveStatus(
            `Remote changes from ${event.updated_by.username} arrived while you were editing. Your next sync will use the current editor state.`
          );
          return;
        }

        applyCollaborationDocumentState(
          event.document,
          event.document.merge_strategy === "char-merge"
            ? `Live merged ${event.updated_by.username}'s changes at ${formatTimestamp(event.document.updated_at)}`
            : `Live update from ${event.updated_by.username} at ${formatTimestamp(event.document.updated_at)}`
        );
      },
      onSnapshot: (event) => {
        setCollaborationPresence(event.presence);
        const liveEditor = editorRef.current;
        const currentSnapshot = documentSnapshot(
          currentTitleRef.current,
          liveEditor?.getHTML() ?? currentContentRef.current
        );
        const hasUnsyncedLocalEdits =
          canEditRef.current &&
          lastCollaborationSnapshot.current !== null &&
          currentSnapshot !== lastCollaborationSnapshot.current;

        if (hasUnsyncedLocalEdits) {
          setSaveStatus("Reconnected. Keeping local edits and syncing them now.");
          return;
        }

        applyCollaborationDocumentState(
          event.document,
          `Live collaboration connected at ${formatTimestamp(event.document.updated_at)}`
        );
      }
    });

    collaborationSessionRef.current = session;
    session.connect();

    return () => {
      if (collaborationSessionRef.current === session) {
        collaborationSessionRef.current = null;
      }
      session.close();
    };
  }, [auth.accessToken, document?.id, guestKey, guestSession?.actor.id, shareToken]);

  useEffect(() => {
    if (!document || !canViewAiHistory) {
      setAiHistory([]);
      return;
    }

    const activeDocumentId = document.id;
    let isMounted = true;

    async function loadAiHistory() {
      setIsAiHistoryLoading(true);
      try {
        const response = await listAiHistory(activeDocumentId, {
          action: aiHistoryActionFilter === "all" ? undefined : aiHistoryActionFilter,
          resolution: aiHistoryResolutionFilter === "all" ? undefined : aiHistoryResolutionFilter
        });
        if (isMounted) {
          setAiHistory(response.interactions);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load AI history");
        }
      } finally {
        if (isMounted) {
          setIsAiHistoryLoading(false);
        }
      }
    }

    void loadAiHistory();

    return () => {
      isMounted = false;
    };
  }, [
    aiHistoryActionFilter,
    aiHistoryRefreshToken,
    aiHistoryResolutionFilter,
    canViewAiHistory,
    document?.id
  ]);

  useEffect(() => {
    if (!document || !canEdit) {
      return;
    }

    const snapshot = documentSnapshot(title, content);

    if (snapshot === lastSavedSnapshot.current) {
      return;
    }

    setSaveStatus("Unsaved changes");

    const timeoutId = window.setTimeout(() => {
      void persistDocument("autosave");
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canEdit, content, document?.id, title]);

  useEffect(() => {
    if (!document || !canEdit || !collaborationSessionRef.current) {
      return;
    }

    const snapshot = documentSnapshot(title, content);
    if (snapshot === lastCollaborationSnapshot.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      collaborationSessionRef.current?.sendUpdate({
        title: title.trim(),
        content,
        base_version_id: lastSyncedVersionIdRef.current,
        base_title: lastSyncedTitleRef.current,
        base_content: lastSyncedContentRef.current
      });
      collaborationSessionRef.current?.sendActivity(
        editorRef.current ? buildSelectionPresence(editorRef.current) : undefined
      );
      setSaveStatus(
        collaborationState === "connected"
          ? "Live syncing..."
          : "Offline. Local edits will sync when collaboration reconnects."
      );
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canEdit, collaborationState, content, document?.id, title]);

  useEffect(() => {
    if (!aiReview) {
      setSelectedSegments([]);
      return;
    }
    setSelectedSegments(buildDefaultSegmentIndexes(splitSuggestionSegments(aiReview.suggestion_text).length));
  }, [aiReview?.interaction_id]);

  useEffect(() => {
    setSelectedSegments((current) => current.filter((index) => index < suggestionSegments.length));
  }, [proposalDraft]);

  async function persistDocument(
    saveSource: "autosave" | "manual-update",
    contentOverride?: string
  ) {
    if (!document) {
      return null;
    }

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setSaveStatus("Title is required before saving");
      return null;
    }

    setSaveStatus(saveSource === "autosave" ? "Autosaving..." : "Saving...");

    try {
      const nextDocument =
        guestSession && shareToken && guestKey
          ? await updateGuestDocument(shareToken, document.id, guestKey, {
              title: normalizedTitle,
              content: contentOverride ?? content,
              save_source: saveSource,
              base_version_id: lastSyncedVersionIdRef.current,
              base_title: lastSyncedTitleRef.current,
              base_content: lastSyncedContentRef.current
            })
          : await updateDocument(document.id, {
              title: normalizedTitle,
              content: contentOverride ?? content,
              save_source: saveSource,
              base_version_id: lastSyncedVersionIdRef.current,
              base_title: lastSyncedTitleRef.current,
              base_content: lastSyncedContentRef.current
            });
      setErrorMessage("");
      applyDocument(nextDocument);
      return nextDocument;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save document");
      setSaveStatus("Save failed");
      return null;
    }
  }

  async function handleShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document) {
      return;
    }

    setIsSharing(true);
    setErrorMessage("");

    try {
      const nextDocument = await shareDocument(document.id, {
        identifier: shareIdentifier,
        role: shareRole
      });
      setShareIdentifier("");
      applyDocument(nextDocument);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to share document");
    } finally {
      setIsSharing(false);
    }
  }

  async function handleRemoveShare(shareId: string) {
    if (!document) {
      return;
    }

    try {
      const nextDocument = await removeShare(document.id, shareId);
      applyDocument(nextDocument);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to remove share");
    }
  }

  async function handleCreateShareLink(role: "editor" | "viewer") {
    if (!document) {
      return;
    }

    setCreatingShareLinkRole(role);
    setErrorMessage("");

    try {
      const nextDocument = await createShareLink(document.id, { role });
      applyDocument(nextDocument);
      setShareLinkStatusMessage(
        `${role === "editor" ? "Edit" : "View"} link is ready. Copy it from the sharing panel.`
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create share link");
    } finally {
      setCreatingShareLinkRole(null);
    }
  }

  async function handleRevokeShareLink(shareLinkId: string) {
    if (!document) {
      return;
    }

    setRevokingShareLinkId(shareLinkId);
    setErrorMessage("");

    try {
      const nextDocument = await revokeShareLink(document.id, shareLinkId);
      applyDocument(nextDocument);
      setShareLinkStatusMessage("Share link revoked.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to revoke share link");
    } finally {
      setRevokingShareLinkId(null);
    }
  }

  async function handleCopyShareLink(token: string) {
    const shareUrl = `${window.location.origin}/shared/${documentId}?token=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareLinkStatusMessage("Share link copied to the clipboard.");
    } catch {
      window.prompt("Copy share link", shareUrl);
      setShareLinkStatusMessage("Share link opened for manual copy.");
    }
  }

  async function handleRestore(versionId: string) {
    if (!document) {
      return;
    }

    setRestoringVersionId(versionId);

    try {
      const nextDocument = await restoreVersion(document.id, { version_id: versionId });
      applyDocument(nextDocument);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to restore version");
    } finally {
      setRestoringVersionId(null);
    }
  }

  async function handleDeleteDocument() {
    if (!document) {
      return;
    }

    setIsDeleting(true);

    try {
      await deleteDocument(document.id);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete document");
      setIsDeleting(false);
    }
  }

  async function handleRunAiAction() {
    if (!editor || !document) {
      return;
    }

    const selection = getSelectionPayload(editor);
    if (!selection) {
      setErrorMessage("Select text in the editor before requesting AI help");
      return;
    }

    const requestedDocumentVersionId = document.versions[0]?.id ?? "";
    const editorHtmlAtRequest = editor.getHTML();

    setErrorMessage("");
    setIsAiSubmitting(true);
    setAiReview(null);
    setProposalDraft("");
    setAiStreamText("");
    aiStreamTextRef.current = "";
    setDidUndoAiApply(false);
    setAiStatusMessage(`Submitting ${describeAiAction(aiAction).toLowerCase()} request...`);

    const abortController = new AbortController();
    aiAbortControllerRef.current = abortController;

    try {
      await streamAiAction(
        {
          document_id: document.id,
          action: aiAction,
          selection,
          requested_document_version_id: requestedDocumentVersionId,
          instruction: aiInstruction.trim() || undefined,
          target_language: aiAction === "translate" ? aiTargetLanguage.trim() || undefined : undefined
        },
        {
          signal: abortController.signal,
          onAccepted: () => {
            setAiStatusMessage("AI request accepted. Streaming suggestion...");
          },
          onStreaming: (event) => {
            aiStreamTextRef.current = event.accumulated_text;
            setAiStreamText(event.accumulated_text);
          },
          onResult: (result) => {
            const nextStage = editor.getHTML() !== editorHtmlAtRequest ? "stale" : result.stage;
            const nextReview: AiActionResult =
              nextStage === result.stage ? result : { ...result, stage: "stale" };

            setAiReview(nextReview);
            setProposalDraft(result.suggestion_text);
            setAiStreamText(result.suggestion_text);
            setAiStatusMessage(
              nextReview.stage === "stale"
                ? "The target text changed while the request was running. Review carefully before applying."
                : "Suggestion ready for review."
            );
            setAiHistoryRefreshToken((value) => value + 1);
          },
          onFailed: (message) => {
            setErrorMessage(message);
            setAiStatusMessage("AI request failed");
            setAiHistoryRefreshToken((value) => value + 1);
          }
        }
      );
    } catch (error) {
      if (isAbortError(error)) {
        setErrorMessage("");
        setAiStatusMessage(
          aiStreamTextRef.current
            ? "AI request canceled. Partial draft kept for reference."
            : "AI request canceled before any draft text arrived."
        );
      } else {
        setErrorMessage(error instanceof Error ? error.message : "AI request failed");
        setAiStatusMessage("AI request failed");
      }
    } finally {
      if (aiAbortControllerRef.current === abortController) {
        aiAbortControllerRef.current = null;
      }
      setIsAiSubmitting(false);
    }
  }

  function handleCancelAiRequest() {
    if (!isAiSubmitting) {
      return;
    }

    setAiStatusMessage("Canceling AI request...");
    aiAbortControllerRef.current?.abort();
  }

  async function handleRejectAiSuggestion() {
    if (!aiReview) {
      return;
    }

    setIsAiResolving(true);
    setErrorMessage("");

    try {
      await resolveAiInteraction(aiReview.interaction_id, {
        resolution: "rejected"
      });
      setAiReview(null);
      setProposalDraft("");
      setAiStreamText("");
      setAiStatusMessage("Suggestion rejected. The document was left unchanged.");
      setAiHistoryRefreshToken((value) => value + 1);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to reject suggestion");
    } finally {
      setIsAiResolving(false);
    }
  }

  async function handleApplyAiSuggestion() {
    if (!editor || !document || !aiReview) {
      return;
    }

    if (!selectedSuggestionText) {
      setErrorMessage("Select at least one segment before applying the suggestion");
      return;
    }

    const range =
      aiReview.stage === "stale"
        ? {
            from: editor.state.selection.from,
            to: editor.state.selection.to
          }
        : {
            from: aiReview.selection.tiptap_from,
            to: aiReview.selection.tiptap_to
          };

    if (range.from === range.to) {
      setErrorMessage("Select the current target text before applying a stale suggestion");
      return;
    }

    setIsAiResolving(true);
    setErrorMessage("");
    const previousContent = editor.getHTML();
    let didPersistChange = false;

    try {
      editor.chain().focus().insertContentAt(range, plainTextToHtml(selectedSuggestionText)).run();
      const nextContent = editor.getHTML();
      const savedDocument = await persistDocument("manual-update", nextContent);
      if (!savedDocument) {
        editor.commands.setContent(previousContent, false);
        return;
      }
      didPersistChange = true;

      const latestVersionId = savedDocument.versions[0]?.id;
      if (!latestVersionId) {
        throw new Error("Unable to determine the saved document version");
      }

      setUndoAiContent(previousContent);
      setDidUndoAiApply(false);

      const resolution =
        selectedSuggestionText.trim() === aiReview.suggestion_text.trim()
          ? "accepted"
          : "edited-before-apply";

      await resolveAiInteraction(aiReview.interaction_id, {
        resolution,
        applied_document_version_id: latestVersionId,
        final_text: selectedSuggestionText
      });

      setAiReview(null);
      setProposalDraft("");
      setAiStreamText("");
      setAiStatusMessage(
        resolution === "accepted"
          ? "AI suggestion applied as a single saved document change."
          : "Edited AI suggestion applied and linked to the saved document version."
      );
      setAiHistoryRefreshToken((value) => value + 1);
    } catch (error) {
      if (!didPersistChange) {
        editor.commands.setContent(previousContent, false);
      }
      setErrorMessage(error instanceof Error ? error.message : "Failed to apply suggestion");
    } finally {
      setIsAiResolving(false);
    }
  }

  async function handleUndoAiApply() {
    if (!editor || !undoAiContent) {
      return;
    }

    const currentContent = editor.getHTML();
    setErrorMessage("");
    editor.commands.setContent(undoAiContent, false);

    const restoredDocument = await persistDocument("manual-update", undoAiContent);
    if (!restoredDocument) {
      editor.commands.setContent(currentContent, false);
      return;
    }

    setUndoAiContent(null);
    setDidUndoAiApply(true);
    setAiStatusMessage("Last applied AI suggestion was undone.");
  }

  function toggleSegment(index: number) {
    setSelectedSegments((current) =>
      current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((left, right) => left - right)
    );
  }

  if (isLoading) {
    return (
      <section className="panel">
        <h2>Loading document...</h2>
      </section>
    );
  }

  if (!document) {
    return (
      <section className="panel">
        <h2>Document unavailable</h2>
        <p className="error-text">{errorMessage || "The requested document could not be loaded."}</p>
      </section>
    );
  }

  const versionsById = new Map(document.versions.map((version) => [version.id, version]));
  const restoredAtBySourceVersionId = new Map<string, string>();

  for (const version of document.versions) {
    if (version.restored_from_version_id) {
      restoredAtBySourceVersionId.set(version.restored_from_version_id, version.created_at);
    }
  }

  const previewVersion =
    previewVersionId === null
      ? null
      : document.versions.find((version) => version.id === previewVersionId) ?? null;

  const previewSourceVersion = previewVersion?.restored_from_version_id
    ? versionsById.get(previewVersion.restored_from_version_id) ?? null
    : null;
  const aiHistoryTotals = aiHistory.reduce(
    (totals, interaction) => ({
      estimatedCostUsd: totals.estimatedCostUsd + (interaction.estimated_cost_usd ?? 0),
      inputTokens: totals.inputTokens + (interaction.input_tokens ?? 0),
      outputTokens: totals.outputTokens + (interaction.output_tokens ?? 0)
    }),
    {
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0
    }
  );

  return (
    <div className="document-workspace">
      <aside className="sidebar-stack sidebar-left">
        <CollaborationPanel
          connectionState={collaborationState}
          currentUserId={currentUserId}
          presence={collaborationPresence}
        />

        <ShareAccessPanel
          canManageShares={Boolean(canManageShares)}
          copyStatusMessage={shareLinkStatusMessage}
          document={document}
          isCreatingLinkRole={creatingShareLinkRole}
          isGuestAccess={Boolean(guestSession)}
          isRevokingLinkId={revokingShareLinkId}
          isSharing={isSharing}
          onCopyLink={handleCopyShareLink}
          onCreateLink={(role) => void handleCreateShareLink(role)}
          onRemoveShare={(shareId) => void handleRemoveShare(shareId)}
          onRevokeLink={(shareLinkId) => void handleRevokeShareLink(shareLinkId)}
          onShareIdentifierChange={setShareIdentifier}
          onShareRoleChange={setShareRole}
          onSubmitShare={handleShare}
          shareIdentifier={shareIdentifier}
          shareRole={shareRole}
        />
      </aside>

      <section className="panel document-main-column">
        <div className="document-header">
          <div>
            <div className="document-meta-line">
              <RoleBadge role={document.role} />
              <span>Owner: {document.owner.username}</span>
              <span>Updated: {formatTimestamp(document.updated_at)}</span>
            </div>

            <input
              className="document-title-input"
              disabled={!canEdit}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="document-actions">
            {canEdit ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => void persistDocument("manual-update")}
              >
                Save now
              </button>
            ) : null}
            {canManageShares ? (
              <button
                className="danger-button"
                disabled={isDeleting}
                type="button"
                onClick={() => void handleDeleteDocument()}
              >
                {isDeleting ? "Deleting..." : "Delete document"}
              </button>
            ) : null}
          </div>
        </div>

        <p className="save-chip">{saveStatus}</p>
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        {guestSession ? (
          <p className="preview-flag">
            Opened as {guestSession.actor.username} through a {guestSession.role} link.
          </p>
        ) : null}
        {!canEdit ? (
          <p className="muted-copy">
            You have {document.role} access. The editor is read-only, and server-side
            permissions will reject direct write attempts too.
          </p>
        ) : null}

        {canUseAi ? (
          <section className="ai-section">
            <div className="preview-header">
              <div>
                <h2>AI Writing Assistant</h2>
                <p className="muted-copy">
                  AI requests are scoped to the selected text, nearby context, and a short heading
                  outline. Suggestions stay review-first until you apply them.
                </p>
              </div>
              <div className="document-actions">
                {undoAiContent ? (
                  <button
                    className="ghost-button"
                    disabled={isAiResolving}
                    type="button"
                    onClick={() => void handleUndoAiApply()}
                  >
                    Undo last AI apply
                  </button>
                ) : null}
                <span className="save-chip ai-status-chip">{aiStatusMessage}</span>
              </div>
            </div>

            <div className="ai-action-row">
              {(["rewrite", "summarize", "translate", "restructure"] as const).map((action) => (
                <button
                  key={action}
                  className={`toolbar-button${aiAction === action ? " active" : ""}`}
                  type="button"
                  onClick={() => setAiAction(action)}
                >
                  {describeAiAction(action)}
                </button>
              ))}
            </div>

            <div className="ai-form-grid">
              {aiAction === "translate" ? (
                <label className="field">
                  <span>Target language</span>
                  <input
                    value={aiTargetLanguage}
                    onChange={(event) => setAiTargetLanguage(event.target.value)}
                    placeholder="English, Arabic, Chinese..."
                  />
                </label>
              ) : null}

              <label className="field ai-wide-field">
                <span>Optional instruction</span>
                <input
                  value={aiInstruction}
                  onChange={(event) => setAiInstruction(event.target.value)}
                  placeholder="For example: shorter, more formal, or clearer for beginners"
                />
              </label>
            </div>

            <div className="document-actions ai-submit-row">
              <button
                className="primary-button"
                disabled={isAiSubmitting || !hasTextSelection}
                type="button"
                onClick={() => void handleRunAiAction()}
              >
                {isAiSubmitting ? "Requesting..." : `Run ${describeAiAction(aiAction)}`}
              </button>
              {isAiSubmitting ? (
                <button className="ghost-button" type="button" onClick={handleCancelAiRequest}>
                  Cancel
                </button>
              ) : null}
              {!hasTextSelection ? (
                <p className="muted-copy">Select text in the editor to enable AI actions.</p>
              ) : null}
            </div>

            {aiStreamText && !aiReview ? (
              <div className="ai-stream-card">
                <strong>Streaming draft</strong>
                <pre>{aiStreamText}</pre>
              </div>
            ) : null}

            {aiReview ? (
              <div className="ai-review-shell">
                <div className={`ai-review-banner${aiReview.stage === "stale" ? " ai-review-banner-stale" : ""}`}>
                  <strong>{aiReview.stage === "stale" ? "Stale suggestion" : "Suggestion ready"}</strong>
                  <span>
                    Requested at {formatTimestamp(aiReview.requested_at)} with model {aiReview.model_id}
                  </span>
                </div>

                <div className={`ai-review-grid${aiReview.stage === "stale" ? " ai-review-grid-stale" : ""}`}>
                  <article className="ai-review-card">
                    <h3>Original at request time</h3>
                    <pre>{aiReview.original_text}</pre>
                  </article>

                  {aiReview.stage === "stale" ? (
                    <article className="ai-review-card">
                      <h3>Current text now</h3>
                      <pre>
                        {currentReviewText ||
                          "The document changed while the AI request was running. Reselect the target text before applying."}
                      </pre>
                    </article>
                  ) : null}

                  <article className="ai-review-card ai-review-card-editable">
                    <h3>Proposal</h3>
                    <textarea
                      className="ai-proposal-textarea"
                      value={proposalDraft}
                      onChange={(event) => setProposalDraft(event.target.value)}
                    />
                  </article>
                </div>

                {suggestionSegments.length > 1 ? (
                  <div className="ai-segments">
                    <strong>Apply selected segments</strong>
                    <div className="stack-list">
                      {suggestionSegments.map((segment, index) => (
                        <label key={`${aiReview.interaction_id}-${index}`} className="ai-segment-card">
                          <input
                            checked={selectedSegments.includes(index)}
                            type="checkbox"
                            onChange={() => toggleSegment(index)}
                          />
                          <span>{segment}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {aiReview.stage === "stale" ? (
                  <p className="preview-flag">
                    This suggestion is stale. Review the current text and reselect the live target
                    range before applying it.
                  </p>
                ) : null}

                <div className="document-actions">
                  <button
                    className="primary-button"
                    disabled={isAiResolving}
                    type="button"
                    onClick={() => void handleApplyAiSuggestion()}
                  >
                    {isAiResolving
                      ? "Applying..."
                      : aiReview.stage === "stale"
                        ? "Apply to current selection"
                        : "Apply suggestion"}
                  </button>
                  <button
                    className="ghost-button"
                    disabled={isAiResolving}
                    type="button"
                    onClick={() => void handleRejectAiSuggestion()}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : null}

            {didUndoAiApply ? (
              <p className="muted-copy">The last accepted AI change was restored as a new saved version.</p>
            ) : null}
          </section>
        ) : (
          <section className="ai-section">
            <h2>AI Writing Assistant</h2>
            <p className="muted-copy">
              {guestSession
                ? "AI actions stay disabled in guest mode. Open the private document view after signing in if you want to use the assistant."
                : "AI actions are limited to owners and editors because they can create document changes that are later versioned and reviewed."}
            </p>
          </section>
        )}

        <RichTextToolbar editor={editor} disabled={!canEdit} />
        <div className="editor-surface">
          <EditorContent editor={editor} />
        </div>
      </section>

      <aside className="sidebar-stack sidebar-right">
        <section className="panel">
          <div className="preview-header">
            <div>
              <h2>Version preview</h2>
              <p className="muted-copy">
                Preview a historical snapshot here before you decide to restore it.
              </p>
            </div>
            {previewVersion ? (
              <button className="ghost-link" type="button" onClick={() => setPreviewVersionId(null)}>
                Clear
              </button>
            ) : null}
          </div>

          {previewVersion ? (
            <div className="preview-pane">
              <div className="preview-meta">
                <strong>{previewVersion.title}</strong>
                <span>{describeVersionSource(previewVersion.source)}</span>
                <span>{formatTimestamp(previewVersion.created_at)}</span>
                <span>By {previewVersion.created_by.username}</span>
              </div>

              {previewVersion.restored_from_version_id && previewSourceVersion ? (
                <p className="preview-flag">
                  Restored from {formatTimestamp(previewSourceVersion.created_at)}
                </p>
              ) : null}

              {restoredAtBySourceVersionId.has(previewVersion.id) ? (
                <p className="preview-flag">
                  Restored on {formatTimestamp(restoredAtBySourceVersionId.get(previewVersion.id)!)}
                </p>
              ) : null}

              <h3 className="preview-title">{previewVersion.title}</h3>
              <div
                className="preview-surface"
                dangerouslySetInnerHTML={{ __html: previewVersion.content }}
              />
            </div>
          ) : (
            <p className="muted-copy">
              Pick any version from the history below to inspect it in a separate right-side view.
            </p>
          )}
        </section>

        <section className="panel">
          <div className="preview-header">
            <div>
              <h2>AI history</h2>
              <p className="muted-copy">
                Review AI requests, their outcomes, which saved version an accepted suggestion
                landed in, and the estimated token and cost footprint of each request.
              </p>
            </div>
          </div>

          {canViewAiHistory ? (
            <>
              <div className="history-summary-grid">
                <article className="list-card">
                  <strong>Total estimated cost</strong>
                  <p>{formatEstimatedCost(aiHistoryTotals.estimatedCostUsd)}</p>
                </article>
                <article className="list-card">
                  <strong>Input tokens</strong>
                  <p>{aiHistoryTotals.inputTokens.toLocaleString()}</p>
                </article>
                <article className="list-card">
                  <strong>Output tokens</strong>
                  <p>{aiHistoryTotals.outputTokens.toLocaleString()}</p>
                </article>
              </div>

              <div className="history-filter-grid">
                <label className="field">
                  <span>Action</span>
                  <select
                    value={aiHistoryActionFilter}
                    onChange={(event) => setAiHistoryActionFilter(event.target.value)}
                  >
                    <option value="all">All actions</option>
                    <option value="rewrite">Rewrite</option>
                    <option value="summarize">Summarize</option>
                    <option value="translate">Translate</option>
                    <option value="restructure">Restructure</option>
                  </select>
                </label>

                <label className="field">
                  <span>Status</span>
                  <select
                    value={aiHistoryResolutionFilter}
                    onChange={(event) => setAiHistoryResolutionFilter(event.target.value)}
                  >
                    <option value="all">All outcomes</option>
                    <option value="pending-review">Pending review</option>
                    <option value="accepted">Accepted</option>
                    <option value="edited-before-apply">Edited before apply</option>
                    <option value="rejected">Rejected</option>
                    <option value="expired">Expired</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
              </div>

              <div className="stack-list">
                {isAiHistoryLoading ? (
                  <p className="muted-copy">Loading AI history...</p>
                ) : aiHistory.length === 0 ? (
                  <p className="muted-copy">No AI interactions match the current filters yet.</p>
                ) : (
                  aiHistory.map((interaction) => (
                    <article key={interaction.id} className="list-card">
                      <div className="document-meta-line">
                        <strong>{describeAiAction(interaction.action)}</strong>
                        <span>{describeAiResolution(interaction)}</span>
                      </div>
                      <p>{interaction.selection_text_preview}</p>
                      <p>
                        Requested by {interaction.requested_by.username} on{" "}
                        {formatTimestamp(interaction.requested_at)}
                      </p>
                      <p>Model: {interaction.model_id}</p>
                      <p>
                        Tokens: {formatTokenCount(interaction.input_tokens)} in /{" "}
                        {formatTokenCount(interaction.output_tokens)} out
                      </p>
                      <p>Estimated cost: {formatEstimatedCost(interaction.estimated_cost_usd)}</p>
                      {interaction.applied_document_version_id ? (
                        <p className="history-flag">
                          Applied into version {interaction.applied_document_version_id.slice(0, 8)}
                        </p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="muted-copy">Only document owners can inspect AI history.</p>
          )}
        </section>

        <section className="panel">
          <h2>Version history</h2>
          <div className="stack-list">
            {document.versions.map((version) => (
              <article
                key={version.id}
                className={`list-card${previewVersion?.id === version.id ? " list-card-active" : ""}`}
              >
                <div>
                  <strong>{describeVersionSource(version.source)}</strong>
                  <p>
                    {formatTimestamp(version.created_at)} by {version.created_by.username}
                  </p>
                  {version.restored_from_version_id ? (
                    <p className="history-flag">
                      Restored from{" "}
                      {formatTimestamp(
                        versionsById.get(version.restored_from_version_id)?.created_at ?? version.created_at
                      )}
                    </p>
                  ) : null}
                  {restoredAtBySourceVersionId.has(version.id) ? (
                    <p className="history-flag">
                      Restored on {formatTimestamp(restoredAtBySourceVersionId.get(version.id)!)}
                    </p>
                  ) : null}
                </div>
                <div className="history-actions">
                  <button
                    className="ghost-link"
                    type="button"
                    onClick={() => setPreviewVersionId(version.id)}
                  >
                    {previewVersion?.id === version.id ? "Previewing" : "Preview"}
                  </button>
                  {canRestoreVersions ? (
                    <button
                      className="ghost-link"
                      disabled={restoringVersionId === version.id}
                      type="button"
                      onClick={() => void handleRestore(version.id)}
                    >
                      {restoringVersionId === version.id ? "Restoring..." : "Restore"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
