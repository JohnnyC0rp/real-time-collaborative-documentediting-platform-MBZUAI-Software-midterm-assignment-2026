import type { CollaborationPresence } from "@collab/shared";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Editor } from "@tiptap/react";

const remotePresencePluginKey = new PluginKey<DecorationSet>("remote-presence");

function clampDocumentPosition(position: number | null, maxPosition: number) {
  if (position === null) {
    return null;
  }
  return Math.max(1, Math.min(position, maxPosition));
}

function buildCursorWidget(presence: CollaborationPresence) {
  const widget = document.createElement("span");
  widget.className = "remote-cursor-pill";
  widget.style.setProperty("--remote-cursor-color", presence.cursor_color);
  widget.textContent = presence.username;
  return widget;
}

function buildRemoteDecorations(
  doc: ProseMirrorNode,
  presence: CollaborationPresence[],
  currentUserId: string | null
) {
  const decorations: Decoration[] = [];
  const maxPosition = Math.max(1, doc.content.size);

  for (const entry of presence) {
    if (entry.user_id === currentUserId) {
      continue;
    }

    const from = clampDocumentPosition(entry.selection_from, maxPosition);
    const to = clampDocumentPosition(entry.selection_to, maxPosition);

    if (from === null || to === null) {
      continue;
    }

    const selectionStart = Math.min(from, to);
    const selectionEnd = Math.max(from, to);

    if (selectionEnd > selectionStart) {
      decorations.push(
        Decoration.inline(selectionStart, selectionEnd, {
          class: "remote-selection-highlight",
          style: `--remote-selection-color: ${entry.cursor_color};`
        })
      );
    }

    decorations.push(
      Decoration.widget(selectionEnd, () => buildCursorWidget(entry), {
        side: 1
      })
    );
  }

  return DecorationSet.create(doc, decorations);
}

export const RemotePresenceExtension = Extension.create<{
  getCurrentUserId: () => string | null;
  getPresence: () => CollaborationPresence[];
}>({
  name: "remotePresence",

  addOptions() {
    return {
      getCurrentUserId: () => null,
      getPresence: () => []
    };
  },

  addProseMirrorPlugins() {
    const getPresence = this.options.getPresence;
    const getCurrentUserId = this.options.getCurrentUserId;

    return [
      new Plugin({
        key: remotePresencePluginKey,
        state: {
          init: (_config, editorState) =>
            buildRemoteDecorations(editorState.doc, getPresence(), getCurrentUserId()),
          apply: (transaction, _oldState, _oldEditorState, newEditorState) => {
            const nextPresence =
              (transaction.getMeta(remotePresencePluginKey) as CollaborationPresence[] | undefined) ??
              getPresence();
            return buildRemoteDecorations(newEditorState.doc, nextPresence, getCurrentUserId());
          }
        },
        props: {
          decorations(editorState) {
            return remotePresencePluginKey.getState(editorState);
          }
        }
      })
    ];
  }
});

export function pushRemotePresence(editor: Editor | null, presence: CollaborationPresence[]) {
  if (!editor || !("view" in editor) || !editor.view) {
    return;
  }

  editor.view.dispatch(editor.state.tr.setMeta(remotePresencePluginKey, presence));
}
