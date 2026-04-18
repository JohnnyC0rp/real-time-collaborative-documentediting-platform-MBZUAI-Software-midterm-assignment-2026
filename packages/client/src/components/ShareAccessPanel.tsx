import type { DocumentDetail } from "@collab/shared";
import type { FormEvent } from "react";
import { RoleBadge } from "./RoleBadge";

interface ShareAccessPanelProps {
  canManageShares: boolean;
  copyStatusMessage: string;
  document: DocumentDetail;
  isCreatingLinkRole: "editor" | "viewer" | null;
  isGuestAccess: boolean;
  isRevokingLinkId: string | null;
  isSharing: boolean;
  onCopyLink: (token: string) => void;
  onCreateLink: (role: "editor" | "viewer") => void;
  onRemoveShare: (shareId: string) => void;
  onRevokeLink: (shareLinkId: string) => void;
  onShareIdentifierChange: (value: string) => void;
  onShareRoleChange: (value: "editor" | "viewer") => void;
  onSubmitShare: (event: FormEvent<HTMLFormElement>) => void;
  shareIdentifier: string;
  shareRole: "editor" | "viewer";
}

function buildShareUrl(documentId: string, token: string) {
  return `${window.location.origin}/shared/${documentId}?token=${encodeURIComponent(token)}`;
}

export function ShareAccessPanel({
  canManageShares,
  copyStatusMessage,
  document,
  isCreatingLinkRole,
  isGuestAccess,
  isRevokingLinkId,
  isSharing,
  onCopyLink,
  onCreateLink,
  onRemoveShare,
  onRevokeLink,
  onShareIdentifierChange,
  onShareRoleChange,
  onSubmitShare,
  shareIdentifier,
  shareRole
}: ShareAccessPanelProps) {
  const activeShareLinks = document.share_links.filter((shareLink) => shareLink.revoked_at === null);

  return (
    <section className="panel">
      <h2>Sharing</h2>
      {isGuestAccess ? (
        <p className="muted-copy">
          This document was opened through a guest link. Only the owner can manage people and
          links from the private document view.
        </p>
      ) : canManageShares ? (
        <>
          <form className="stack-form" onSubmit={onSubmitShare}>
            <label className="field">
              <span>Email or username</span>
              <input
                value={shareIdentifier}
                onChange={(event) => onShareIdentifierChange(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Role</span>
              <select
                value={shareRole}
                onChange={(event) => onShareRoleChange(event.target.value as "editor" | "viewer")}
              >
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

          <div className="share-link-actions">
            <button
              className="ghost-button"
              disabled={isCreatingLinkRole !== null}
              type="button"
              onClick={() => onCreateLink("viewer")}
            >
              {isCreatingLinkRole === "viewer" ? "Creating view link..." : "Create viewer link"}
            </button>
            <button
              className="ghost-button"
              disabled={isCreatingLinkRole !== null}
              type="button"
              onClick={() => onCreateLink("editor")}
            >
              {isCreatingLinkRole === "editor" ? "Creating edit link..." : "Create editor link"}
            </button>
          </div>

          {copyStatusMessage ? <p className="muted-copy">{copyStatusMessage}</p> : null}

          <div className="stack-list">
            {activeShareLinks.length === 0 ? (
              <p className="muted-copy">No guest links yet.</p>
            ) : (
              activeShareLinks.map((shareLink) => (
                <article key={shareLink.id} className="list-card share-link-card">
                  <div>
                    <strong>{shareLink.role === "editor" ? "Edit link" : "View link"}</strong>
                    <p className="share-link-url">{buildShareUrl(document.id, shareLink.token)}</p>
                  </div>
                  <div className="share-actions">
                    <RoleBadge role={shareLink.role} />
                    <button
                      className="ghost-link"
                      type="button"
                      onClick={() => onCopyLink(shareLink.token)}
                    >
                      Copy
                    </button>
                    <button
                      className="ghost-link"
                      disabled={isRevokingLinkId === shareLink.id}
                      type="button"
                      onClick={() => onRevokeLink(shareLink.id)}
                    >
                      {isRevokingLinkId === shareLink.id ? "Revoking..." : "Revoke"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </>
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
                    onClick={() => onRemoveShare(share.id)}
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
  );
}
