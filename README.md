# Collaborative Document Editor

This repository contains the final implementation of the AI1220 collaborative
document editor assignment. The application is a React plus TypeScript frontend,
a FastAPI backend, and a shared contract package for browser-facing types.

## Features

- Registration, login, access-token rotation, and silent refresh via an
  HTTP-only refresh cookie.
- Protected dashboard and document routes with server-side authorization on
  every document and AI endpoint.
- Document CRUD, sharing with `owner`, `editor`, and `viewer` roles, auto-save,
  version history, and restore.
- Rich-text editing with headings, bold, italic, ordered lists, bullet lists,
  and code blocks.
- Real-time collaboration over authenticated WebSockets with presence, activity
  awareness, reconnection, and last-write-wins reconciliation.
- AI rewrite, summarize, translate, and restructure actions streamed with SSE,
  plus compare/apply/reject/edit review flow, cancellation, undo-after-apply,
  prompt configuration, provider abstraction, and per-document history.
- Automated backend and frontend tests for the core auth, document, AI, and
  collaboration flows required by the assignment baseline.

## Stack

- Frontend: React, React Router, Vite, Tiptap, Vitest, React Testing Library
- Backend: FastAPI, PyJWT, pwdlib, pytest
- Persistence: JSON file storage in `packages/server/data`
- Live sync: WebSocket document channel
- AI streaming: SSE from FastAPI `StreamingResponse`
- AI providers: local fallback, OpenAI-compatible API, or Gemini

## Repository Layout

```text
.
├── DEVIATIONS.md
├── docs
│   └── part3-ai-assistant.md
├── logs
├── packages
│   ├── client
│   ├── server
│   └── shared
├── .env.example
├── package.json
└── run.sh
```

## Setup

1. Install workspace dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

3. Keep `AI_PROVIDER=local` for an offline baseline, or configure one of:
   - `AI_PROVIDER=openai` with `OPENAI_API_KEY` and `OPENAI_MODEL`
   - `AI_PROVIDER=gemini` with `GEMINI_API_KEY` and `GEMINI_MODEL`

## Run Locally

Start both apps with one command:

```bash
./run.sh
```

The script writes logs to `logs/software-ass2-backend.log` and
`logs/software-ass2-frontend.log`.

Useful URLs:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend: [http://localhost:8000](http://localhost:8000)
- FastAPI docs: [http://localhost:8000/docs](http://localhost:8000/docs)

You can still run each process separately when needed:

```bash
npm run dev:server
npm run dev:client
```

## Testing and Validation

Run the full assignment test suite:

```bash
npm test
```

Run build and type/compile checks:

```bash
npm run check
```

Package-specific commands:

```bash
npm run test:server
npm run test:client
```

## Architecture Overview

### Authentication and Sessions

- Passwords are hashed with bcrypt through `pwdlib`.
- Login and registration issue a short-lived access token plus a refresh token
  stored in an HTTP-only cookie.
- The frontend keeps the access token in memory and retries one refresh cycle
  before surfacing an auth failure.

### Documents and Versioning

- The backend stores users, documents, shares, versions, refresh sessions, and
  AI interaction records in one JSON file.
- Every document change appends a version entry with provenance such as
  `initial`, `autosave`, `manual-update`, or `restore`.
- Owners manage shares and deletion; editors can modify content and invoke AI;
  viewers stay read-only even if they craft direct API requests.

### Real-Time Collaboration

- Each open document creates an authenticated WebSocket connection to
  `/api/collaboration/documents/{document_id}`.
- The server sends a `snapshot` on join, `presence` updates when participants
  connect or show activity, `ack` for accepted local writes, and
  `document.updated` for remote writes.
- The baseline sync strategy is last-write-wins. When a client reconnects with
  unsynced local edits, it keeps the local editor state and flushes the latest
  pending update after the server snapshot arrives.

### AI Flow

- AI requests are scoped to the current selection plus bounded before/after
  context and a small outline summary instead of the entire document.
- Prompt templates live in `packages/server/app/ai/prompts/`.
- The server streams accepted, token-chunk, and final result events over SSE.
- The client keeps every AI result review-first until the user applies,
  edits-before-apply, rejects, or undoes it.
- During collaboration, the UI marks a suggestion as stale if the target text
  changed while generation was running.

## Documentation

- `DEVIATIONS.md` records architecture changes and simplifications relative to
  the earlier design direction.
- `docs/part3-ai-assistant.md` explains the AI assistant behavior in more
  detail.

## Security Note

Do not commit real credentials, API keys, or personal secrets. Keep `.env`
local, use `.env.example` as the placeholder template, and rotate any secret if
it was exposed by mistake.
