import type {
  AiFeature,
  AiLength,
  AiTone,
  DocumentAiInteraction,
  DocumentDetail
} from "@collab/shared";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { streamAiSuggestion, updateAiInteractionStatus, updateDocument } from "../lib/documents";

interface AiAssistantPanelProps {
  canEdit: boolean;
  document: DocumentDetail;
  editor: Editor | null;
  title: string;
  onDocumentSaved: (nextDocument: DocumentDetail) => void;
}

interface UndoSnapshot {
  content: string;
}

interface SelectionSnapshot {
  content: string;
  range: {
    from: number;
    to: number;
  } | null;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

function labelForFeature(feature: AiFeature) {
  switch (feature) {
    case "rewrite":
      return "Rewrite";
    case "summarize":
      return "Summarize";
    case "fix_grammar":
      return "Fix grammar";
    default:
      return feature;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(value: string) {
  const lines = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "<p></p>";
  }

  const looksLikeList = lines.every((line) => line.startsWith("- ") || line.startsWith("* "));
  if (looksLikeList) {
    const items = lines
      .map((line) => `<li>${escapeHtml(line.slice(2).trim())}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }

  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function selectedTextFromEditor(editor: Editor) {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, "\n").trim();
}

function selectionSnapshotFromEditor(editor: Editor): SelectionSnapshot {
  const { from, to } = editor.state.selection;
  return {
    content: editor.getHTML(),
    range: from === to ? null : { from, to }
  };
}

export function AiAssistantPanel({
  canEdit,
  document,
  editor,
  title,
  onDocumentSaved
}: AiAssistantPanelProps) {
  const [feature, setFeature] = useState<AiFeature>("rewrite");
  const [tone, setTone] = useState<AiTone>("clear");
  const [outputLength, setOutputLength] = useState<AiLength>("medium");
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<DocumentAiInteraction["selection_mode"] | null>(null);
  const [originalText, setOriginalText] = useState("");
  const [suggestionText, setSuggestionText] = useState("");
  const [streamMessage, setStreamMessage] = useState("");
  const [streamError, setStreamError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [hasUndoneLastApply, setHasUndoneLastApply] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef("");
  const basisRef = useRef<SelectionSnapshot | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function handleGenerate() {
    if (!editor || !canEdit) {
      return;
    }

    const basis = selectionSnapshotFromEditor(editor);
    const selectedText = selectedTextFromEditor(editor);

    basisRef.current = basis;
    draftRef.current = "";
    setInteractionId(null);
    setSelectionMode(null);
    setOriginalText("");
    setSuggestionText("");
    setStreamError("");
    setStreamMessage("Starting assistant...");
    setHasUndoneLastApply(false);
    setIsRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAiSuggestion(
        document.id,
        {
          feature,
          document_content: basis.content,
          selected_text: selectedText || null,
          tone: feature === "rewrite" ? tone : null,
          output_length: feature === "summarize" ? outputLength : null,
          base_updated_at: document.updated_at
        },
        {
          signal: controller.signal,
          onEvent(event) {
            if (event.type === "start") {
              setInteractionId(event.interaction_id);
              setSelectionMode(event.selection_mode);
              setOriginalText(event.original_text);
              setStreamMessage(`Streaming from ${event.model}`);
              return;
            }

            if (event.type === "chunk") {
              draftRef.current += event.text;
              setSuggestionText(draftRef.current);
              return;
            }

            if (event.type === "done") {
              if (!draftRef.current && event.text) {
                draftRef.current = event.text;
                setSuggestionText(event.text);
              }
              setStreamMessage("Suggestion ready");
              return;
            }

            setStreamError(event.message);
            setStreamMessage(draftRef.current ? "Assistant stopped early. Partial text kept." : "Assistant failed");
          }
        }
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setStreamMessage("Generation canceled");
      } else {
        setStreamError(error instanceof Error ? error.message : "Failed to run the assistant");
        setStreamMessage("Assistant failed");
      }
    } finally {
      abortRef.current = null;
      setIsRunning(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleAccept() {
    if (!editor || !interactionId || !suggestionText.trim() || !basisRef.current) {
      return;
    }

    const currentContent = editor.getHTML();
    if (currentContent !== basisRef.current.content) {
      setStreamError(
        "The document changed after this suggestion was generated. Run it again before applying it."
      );
      return;
    }

    const previousContent = currentContent;
    const nextHtml = textToHtml(suggestionText);

    if (basisRef.current.range) {
      editor.commands.insertContentAt(basisRef.current.range, nextHtml);
    } else {
      editor.commands.setContent(nextHtml, false);
    }

    const updatedContent = editor.getHTML();

    try {
      const savedDocument = await updateDocument(document.id, {
        title,
        content: updatedContent,
        save_source: "manual-update"
      });
      onDocumentSaved(savedDocument);
      setUndoSnapshot({ content: previousContent });
      setHasUndoneLastApply(false);
      setStreamMessage("Suggestion applied");

      const updatedHistoryDocument = await updateAiInteractionStatus(document.id, interactionId, {
        status: "accepted"
      });
      onDocumentSaved(updatedHistoryDocument);
    } catch (error) {
      editor.commands.setContent(previousContent, false);
      setStreamError(error instanceof Error ? error.message : "Failed to apply suggestion");
    }
  }

  async function handleReject() {
    if (!interactionId) {
      return;
    }

    try {
      const nextDocument = await updateAiInteractionStatus(document.id, interactionId, {
        status: "rejected"
      });
      onDocumentSaved(nextDocument);
      setInteractionId(null);
      setStreamMessage("Suggestion rejected");
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Failed to update suggestion status");
    }
  }

  async function handleUndo() {
    if (!editor || !undoSnapshot) {
      return;
    }

    const currentContent = editor.getHTML();
    editor.commands.setContent(undoSnapshot.content, false);

    try {
      const nextDocument = await updateDocument(document.id, {
        title,
        content: undoSnapshot.content,
        save_source: "manual-update"
      });
      onDocumentSaved(nextDocument);
      setUndoSnapshot(null);
      setHasUndoneLastApply(true);
      setStreamMessage("Last applied AI change was undone");
    } catch (error) {
      editor.commands.setContent(currentContent, false);
      setStreamError(error instanceof Error ? error.message : "Failed to undo the last AI change");
    }
  }

  const documentChangedSinceGeneration =
    Boolean(basisRef.current) &&
    Boolean(editor) &&
    basisRef.current?.content !== editor?.getHTML();

  return (
    <section className="panel">
      <div className="preview-header">
        <div>
          <h2>Writing assistant</h2>
          <p className="muted-copy">
            Use the current selection when you want a targeted rewrite. If nothing is selected, the
            assistant uses a trimmed document excerpt and applying it will replace the whole draft.
          </p>
        </div>
        {undoSnapshot ? (
          <button className="ghost-link" type="button" onClick={() => void handleUndo()}>
            Undo last apply
          </button>
        ) : null}
      </div>

      {!canEdit ? (
        <p className="muted-copy">You can read the history here, but only editors can run or apply suggestions.</p>
      ) : null}

      <div className="assistant-controls">
        <label className="field">
          <span>Action</span>
          <select value={feature} onChange={(event) => setFeature(event.target.value as AiFeature)}>
            <option value="rewrite">Rewrite</option>
            <option value="summarize">Summarize</option>
            <option value="fix_grammar">Fix grammar</option>
          </select>
        </label>

        {feature === "rewrite" ? (
          <label className="field">
            <span>Tone</span>
            <select value={tone} onChange={(event) => setTone(event.target.value as AiTone)}>
              <option value="clear">Clear</option>
              <option value="formal">Formal</option>
              <option value="friendly">Friendly</option>
            </select>
          </label>
        ) : null}

        {feature === "summarize" ? (
          <label className="field">
            <span>Length</span>
            <select
              value={outputLength}
              onChange={(event) => setOutputLength(event.target.value as AiLength)}
            >
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="long">Long</option>
            </select>
          </label>
        ) : null}

        <div className="assistant-actions">
          <button
            className="primary-button"
            disabled={!canEdit || !editor || isRunning}
            type="button"
            onClick={() => void handleGenerate()}
          >
            {isRunning ? "Streaming..." : "Run assistant"}
          </button>
          {isRunning ? (
            <button className="ghost-link" type="button" onClick={handleCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      {streamMessage ? <p className="save-chip">{streamMessage}</p> : null}
      {streamError ? <p className="error-text">{streamError}</p> : null}
      {documentChangedSinceGeneration ? (
        <p className="history-flag">
          The editor changed after this suggestion started. Accept is locked until you run it again.
        </p>
      ) : null}
      {hasUndoneLastApply ? <p className="muted-copy">The last accepted suggestion was reverted.</p> : null}

      <div className="assistant-compare">
        <label className="field">
          <span>
            Original {selectionMode === "selection" ? "selection" : selectionMode === "document_excerpt" ? "excerpt" : "text"}
          </span>
          <textarea
            className="assistant-textarea"
            readOnly
            rows={7}
            value={originalText}
          />
        </label>

        <label className="field">
          <span>Suggested text</span>
          <textarea
            className="assistant-textarea"
            onChange={(event) => setSuggestionText(event.target.value)}
            rows={7}
            value={suggestionText}
          />
        </label>
      </div>

      <div className="assistant-actions">
        <button
          className="primary-button"
          disabled={
            !canEdit ||
            !interactionId ||
            !suggestionText.trim() ||
            documentChangedSinceGeneration
          }
          type="button"
          onClick={() => void handleAccept()}
        >
          Accept
        </button>
        <button
          className="ghost-link"
          disabled={!interactionId}
          type="button"
          onClick={() => void handleReject()}
        >
          Reject
        </button>
      </div>

      <div className="stack-list">
        {document.ai_history.length === 0 ? (
          <p className="muted-copy">No assistant activity for this document yet.</p>
        ) : (
          document.ai_history.map((entry) => (
            <article key={entry.id} className="list-card ai-history-card">
              <div className="preview-meta">
                <strong>{labelForFeature(entry.feature)}</strong>
                <span className={`status-chip status-${entry.status}`}>{entry.status.replace("_", " ")}</span>
                <span>{formatTime(entry.requested_at)}</span>
                <span>By {entry.requested_by.username}</span>
              </div>

              <p className="muted-copy">
                {entry.selection_mode === "selection" ? "Ran on a selection." : "Ran on a trimmed document excerpt."}
                {" "}
                Model: {entry.model}
              </p>

              <div className="assistant-history-grid">
                <div>
                  <strong>Prompt</strong>
                  <p className="assistant-history-block">{entry.prompt_text}</p>
                </div>
                <div>
                  <strong>Response</strong>
                  <p className="assistant-history-block">{entry.response_text || "No text returned."}</p>
                </div>
              </div>

              {entry.error_message ? <p className="error-text">{entry.error_message}</p> : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
