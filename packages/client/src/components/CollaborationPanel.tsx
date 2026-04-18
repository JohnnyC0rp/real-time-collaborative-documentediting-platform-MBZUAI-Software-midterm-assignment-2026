import type { CollaborationConnectionState, CollaborationPresence } from "@collab/shared";

interface CollaborationPanelProps {
  connectionState: CollaborationConnectionState;
  currentUserId: string | null;
  presence: CollaborationPresence[];
}

function describeConnectionState(state: CollaborationConnectionState) {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Offline";
    default:
      return state;
  }
}

function describePresence(presence: CollaborationPresence) {
  const lastActiveAt = new Date(presence.last_active_at).getTime();
  const isTyping = Date.now() - lastActiveAt < 5000;
  return isTyping ? "typing now" : "online";
}

export function CollaborationPanel({
  connectionState,
  currentUserId,
  presence
}: CollaborationPanelProps) {
  return (
    <section className="panel">
      <div className="preview-header">
        <div>
          <h2>Live collaboration</h2>
          <p className="muted-copy">
            Signed-in collaborators and Ghost guests share the same WebSocket channel with
            reconnect support, character-level merge recovery, and live cursor awareness.
          </p>
        </div>
        <span className={`status-chip status-${connectionState}`}>{describeConnectionState(connectionState)}</span>
      </div>

      {connectionState !== "connected" ? (
        <p className="history-flag">
          Live sync is offline right now. Local edits stay in the editor and sync again after the
          connection returns.
        </p>
      ) : null}

      <div className="stack-list">
        {presence.length === 0 ? (
          <p className="muted-copy">Nobody else is connected to this document.</p>
        ) : (
          presence.map((entry) => (
            <article key={`${entry.user_id}-${entry.role}`} className="list-card">
              <div>
                <strong className="presence-title">
                  <span
                    aria-hidden="true"
                    className="presence-color-dot"
                    style={{ backgroundColor: entry.cursor_color }}
                  />
                  {entry.username}
                  {entry.user_id === currentUserId ? " (you)" : ""}
                </strong>
                <p>{describePresence(entry)}</p>
                {entry.selection_preview ? (
                  <p>Editing: “{entry.selection_preview}”</p>
                ) : (
                  <p>Cursor is active without a text selection.</p>
                )}
              </div>
              <span className="history-flag">{entry.role}</span>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
