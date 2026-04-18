import type { DocumentDetail } from "@collab/shared";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AiAssistantPanel } from "../components/AiAssistantPanel";
import { RichTextToolbar } from "../components/RichTextToolbar";
import { RoleBadge } from "../components/RoleBadge";
import {
  deleteDocument,
  getDocument,
  removeShare,
  restoreVersion,
  shareDocument,
  updateDocument
} from "../lib/documents";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
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

export function DocumentPage() {
  const navigate = useNavigate();
  const { documentId = "" } = useParams();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("<p></p>");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState("Loading document...");
  const [shareIdentifier, setShareIdentifier] = useState("");
  const [shareRole, setShareRole] = useState<"editor" | "viewer">("viewer");
  const [isSharing, setIsSharing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const lastSavedSnapshot = useRef("");

  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p></p>",
    editable: false,
    immediatelyRender: false,
    onUpdate({ editor: currentEditor }) {
      setContent(currentEditor.getHTML());
    }
  });

  const canEdit = document ? document.role === "owner" || document.role === "editor" : false;
  const canManageShares = document?.role === "owner";

  function applyDocument(nextDocument: DocumentDetail) {
    setDocument(nextDocument);
    setTitle(nextDocument.title);
    setContent(nextDocument.content);
    lastSavedSnapshot.current = JSON.stringify({
      title: nextDocument.title,
      content: nextDocument.content
    });
    setSaveStatus(`Saved at ${formatTimestamp(nextDocument.updated_at)}`);
    if (editor && editor.getHTML() !== nextDocument.content) {
      editor.commands.setContent(nextDocument.content, false);
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
    let isMounted = true;

    async function loadDocument() {
      try {
        const nextDocument = await getDocument(documentId);
        if (isMounted) {
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
  }, [documentId]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setEditable(canEdit);
    if (document && editor.getHTML() !== document.content) {
      editor.commands.setContent(document.content, false);
    }
  }, [canEdit, document?.id, editor]);

  async function persistDocument(saveSource: "autosave" | "manual-update") {
    if (!document) {
      return;
    }

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setSaveStatus("Title is required before saving");
      return;
    }

    setSaveStatus(saveSource === "autosave" ? "Autosaving..." : "Saving...");

    try {
      const nextDocument = await updateDocument(document.id, {
        title: normalizedTitle,
        content,
        save_source: saveSource
      });
      setErrorMessage("");
      applyDocument(nextDocument);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save document");
      setSaveStatus("Save failed");
    }
  }

  useEffect(() => {
    if (!document || !canEdit) {
      return;
    }

    const snapshot = JSON.stringify({
      title: title.trim(),
      content
    });

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

  return (
    <div className="editor-layout">
      <section className="panel">
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
              <button className="primary-button" type="button" onClick={() => void persistDocument("manual-update")}>
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
        {!canEdit ? (
          <p className="muted-copy">
            You have {document.role} access. The editor is read-only, and server-side
            permissions will reject direct write attempts too.
          </p>
        ) : null}

        <RichTextToolbar editor={editor} disabled={!canEdit} />
        <div className="editor-surface">
          <EditorContent editor={editor} />
        </div>
      </section>

      <aside className="sidebar-stack">
        <AiAssistantPanel
          canEdit={canEdit}
          document={document}
          editor={editor}
          onDocumentSaved={applyDocument}
          title={title}
        />

        <section className="panel">
          <div className="preview-header">
            <div>
              <h2>Version preview</h2>
              <p className="muted-copy">
                Preview a historical snapshot here before you decide to restore it.
              </p>
            </div>
            {previewVersion ? (
              <button
                className="ghost-link"
                type="button"
                onClick={() => setPreviewVersionId(null)}
              >
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
          <h2>Sharing</h2>
          {canManageShares ? (
            <form className="stack-form" onSubmit={handleShare}>
              <label className="field">
                <span>Email or username</span>
                <input
                  value={shareIdentifier}
                  onChange={(event) => setShareIdentifier(event.target.value)}
                />
              </label>

              <label className="field">
                <span>Role</span>
                <select value={shareRole} onChange={(event) => setShareRole(event.target.value as "editor" | "viewer")}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
              </label>

              <button
                className="primary-button"
                disabled={isSharing || !shareIdentifier.trim()}
                type="submit"
              >
                {isSharing ? "Sharing..." : "Add or update share"}
              </button>
            </form>
          ) : (
            <p className="muted-copy">Only owners can change sharing rules.</p>
          )}

          <div className="stack-list">
            {document.shares.length === 0 ? (
              <p className="muted-copy">No extra collaborators yet.</p>
            ) : (
              document.shares.map((share) => (
                <article key={share.id} className="list-card">
                  <div>
                    <strong>{share.username}</strong>
                    <p>{share.email}</p>
                  </div>
                  <div className="share-actions">
                    <RoleBadge role={share.role} />
                    {canManageShares ? (
                      <button
                        className="ghost-link"
                        type="button"
                        onClick={() => void handleRemoveShare(share.id)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
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
                  {canEdit ? (
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
