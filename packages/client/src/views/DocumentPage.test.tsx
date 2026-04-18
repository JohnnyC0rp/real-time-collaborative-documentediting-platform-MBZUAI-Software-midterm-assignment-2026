import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const baseDocument = {
    id: "doc-1",
    title: "Project Draft",
    owner_id: "user-1",
    created_at: "2026-04-18T10:00:00Z",
    updated_at: "2026-04-18T10:00:00Z",
    role: "owner" as const,
    owner: {
      id: "user-1",
      username: "johnny",
      email: "johnny@example.com"
    },
    content: "<p>Alpha Beta</p>",
    shares: [],
    share_links: [],
    versions: [
      {
        id: "version-1",
        title: "Project Draft",
        content: "<p>Alpha Beta</p>",
        created_at: "2026-04-18T10:00:00Z",
        created_by: {
          id: "user-1",
          username: "johnny",
          email: "johnny@example.com"
        },
        source: "initial" as const,
        restored_from_version_id: null
      }
    ],
    ai_history: []
  };

  let currentHtml = baseDocument.content;

  const mocks = {
    deleteDocument: vi.fn(),
    getDocument: vi.fn(),
    listAiHistory: vi.fn(),
    removeShare: vi.fn(),
    resolveAiInteraction: vi.fn(),
    restoreVersion: vi.fn(),
    shareDocument: vi.fn(),
    streamAiAction: vi.fn(),
    updateDocument: vi.fn()
  };

  const authState = {
    accessToken: "access-token",
    user: {
      id: "user-1",
      username: "johnny",
      email: "johnny@example.com",
      created_at: "2026-04-18T09:00:00Z"
    }
  };

  const mockEditor = {
    state: {
      selection: {
        from: 1,
        to: 6
      },
      doc: {
        content: {
          size: 10
        },
        descendants: (callback: (node: any, pos: number) => boolean) => {
          callback(
            {
              type: { name: "heading" },
              attrs: { level: 1 },
              textContent: "Intro"
            },
            0
          );
          return true;
        },
        textBetween: (from: number, to: number) => {
          if (from === 0 && to === 1) {
            return "";
          }
          if (from === 1 && to === 6) {
            return "Alpha";
          }
          if (from === 6) {
            return " Beta";
          }
          return "Alpha Beta";
        }
      }
    },
    getHTML: vi.fn(() => currentHtml),
    setEditable: vi.fn(),
    commands: {
      setContent: vi.fn((nextHtml: string) => {
        currentHtml = nextHtml;
      })
    },
    chain: vi.fn(() => ({
      focus: () => ({
        insertContentAt: (_range: unknown, nextHtml: string) => ({
          run: () => {
            currentHtml = nextHtml;
          }
        })
      })
    }))
  };

  class MockCollaborationSession {
    private callbacks: Record<string, any>;

    constructor(_documentId: string, _accessToken: string, callbacks: Record<string, any>) {
      this.callbacks = callbacks;
    }

    connect() {
      this.callbacks.onConnectionStateChange?.("connected");
      this.callbacks.onSnapshot?.({
        type: "snapshot",
        document: {
          id: baseDocument.id,
          title: baseDocument.title,
          content: baseDocument.content,
          updated_at: baseDocument.updated_at,
          version_id: baseDocument.versions[0].id,
          latest_version: baseDocument.versions[0]
        },
        presence: [
          {
            user_id: "user-1",
            username: "johnny",
            role: "owner",
            last_active_at: "2026-04-18T10:00:00Z",
            cursor_color: "#005f73",
            selection_from: 1,
            selection_to: 6,
            selection_preview: "Alpha"
          }
        ]
      });
    }

    close() {}

    sendActivity() {}

    sendUpdate() {}
  }

  return {
    authState,
    baseDocument,
    mockEditor,
    MockCollaborationSession,
    mocks,
    resetCurrentHtml() {
      currentHtml = baseDocument.content;
    }
  };
});

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    ...testState.authState,
    isAuthenticated: true,
    isBootstrapping: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
    register: vi.fn()
  })
}));

vi.mock("../lib/documents", () => ({
  deleteDocument: (...args: unknown[]) => testState.mocks.deleteDocument(...args),
  getDocument: (...args: unknown[]) => testState.mocks.getDocument(...args),
  removeShare: (...args: unknown[]) => testState.mocks.removeShare(...args),
  restoreVersion: (...args: unknown[]) => testState.mocks.restoreVersion(...args),
  shareDocument: (...args: unknown[]) => testState.mocks.shareDocument(...args),
  updateDocument: (...args: unknown[]) => testState.mocks.updateDocument(...args)
}));

vi.mock("../lib/ai", () => ({
  listAiHistory: (...args: unknown[]) => testState.mocks.listAiHistory(...args),
  resolveAiInteraction: (...args: unknown[]) => testState.mocks.resolveAiInteraction(...args),
  streamAiAction: (...args: unknown[]) => testState.mocks.streamAiAction(...args)
}));

vi.mock("../lib/collaboration", () => ({
  DocumentCollaborationSession: testState.MockCollaborationSession
}));

vi.mock("../components/RichTextToolbar", () => ({
  RichTextToolbar: () => <div data-testid="toolbar">Toolbar stub</div>
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="editor-content">Editor stub</div>,
  useEditor: () => testState.mockEditor
}));

vi.mock("@tiptap/starter-kit", () => ({
  default: {}
}));

const { DocumentPage } = await import("./DocumentPage");

describe("DocumentPage", () => {
  beforeEach(() => {
    testState.resetCurrentHtml();
    for (const mock of Object.values(testState.mocks)) {
      mock.mockReset();
    }
    testState.mockEditor.commands.setContent.mockClear();
    testState.mockEditor.getHTML.mockClear();
    testState.mockEditor.setEditable.mockClear();
    testState.mocks.getDocument.mockResolvedValue(structuredClone(testState.baseDocument));
    testState.mocks.listAiHistory.mockResolvedValue({
      interactions: [],
      total: 0
    });
    testState.mocks.updateDocument.mockResolvedValue(structuredClone(testState.baseDocument));
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/documents/doc-1"]}>
        <Routes>
          <Route path="/documents/:documentId" element={<DocumentPage />} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders the editor shell with collaboration presence", async () => {
    renderPage();

    expect(await screen.findByDisplayValue("Project Draft")).toBeInTheDocument();
    expect(screen.getByText("AI Writing Assistant")).toBeInTheDocument();
    expect(screen.getByText("Live collaboration")).toBeInTheDocument();
    expect(screen.getByText(/Connected|Offline/)).toBeInTheDocument();
    expect(screen.getByText("Version history")).toBeInTheDocument();
  });

  it("shows the AI comparison review after a streamed suggestion completes", async () => {
    testState.mocks.streamAiAction.mockImplementation(async (_payload, handlers) => {
      handlers.onAccepted?.({
        interaction_id: "interaction-1",
        action: "rewrite",
        requested_at: "2026-04-18T10:05:00Z",
        model_id: "fake-model"
      });
      handlers.onStreaming?.({
        interaction_id: "interaction-1",
        delta: "Clearer",
        accumulated_text: "Clearer draft"
      });
      handlers.onResult?.({
        interaction_id: "interaction-1",
        document_id: testState.baseDocument.id,
        action: "rewrite",
        stage: "complete",
        resolution: "pending-review",
        requested_at: "2026-04-18T10:05:00Z",
        completed_at: "2026-04-18T10:05:01Z",
        model_id: "fake-model",
        original_text: "Alpha",
        suggestion_text: "A clearer version of Alpha",
        requested_document_version_id: testState.baseDocument.versions[0].id,
        current_document_version_id: testState.baseDocument.versions[0].id,
        target_language: null,
        instruction: null,
        selection: {
          plain_text_start: 0,
          plain_text_end: 5,
          tiptap_from: 1,
          tiptap_to: 6
        }
      });
    });

    renderPage();

    await screen.findByDisplayValue("Project Draft");
    const runButtons = await screen.findAllByRole("button", { name: /Run Rewrite/i });
    await userEvent.click(runButtons.at(-1)!);

    await waitFor(() => {
      expect(testState.mocks.streamAiAction).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Suggestion ready")).toBeInTheDocument();
    expect(screen.getByText("Original at request time")).toBeInTheDocument();
    expect(screen.getByText("Proposal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply suggestion/i })).toBeInTheDocument();
  });
});
