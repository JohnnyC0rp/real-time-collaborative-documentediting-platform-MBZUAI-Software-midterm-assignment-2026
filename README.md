# Collaborative Document Editor

This repository contains the core application for the AI1220 collaborative
document editor assignment. The application uses a React frontend, a FastAPI
backend, and shared TypeScript contracts for the browser-facing data model.

## What the application provides

- Secure registration and login with bcrypt-hashed passwords.
- Short-lived JWT access tokens with refresh-cookie based silent
  re-authentication.
- Protected document routes in the frontend and server-side access checks in the
  backend.
- Document CRUD with ownership metadata and a dashboard that lists every
  document the signed-in user can access.
- Rich-text editing with headings, bold, italic, ordered lists, bullet lists,
  and code blocks.
- Auto-save with visible status feedback.
- Share management with `owner`, `editor`, and `viewer` roles.
- Version history with one-click restore.

## Stack

- Frontend: React, React Router, Vite, Tiptap
- Backend: FastAPI, PyJWT, pwdlib
- Persistence: JSON file storage inside `packages/server/data`

## Repository layout

```text
.
├── docs
│   └── original-instructions
├── packages
│   ├── client
│   │   └── src
│   │       ├── components
│   │       ├── context
│   │       ├── lib
│   │       └── views
│   ├── server
│   │   ├── app
│   │   │   └── routers
│   │   └── data
│   └── shared
│       └── src
├── .env.example
└── package.json
```

## Local setup

1. Install JavaScript dependencies:

```bash
npm install
```

2. Create a local environment file:

```bash
cp .env.example .env
```

3. Start the FastAPI backend:

```bash
npm run dev:server
```

4. In another terminal, start the React client:

```bash
npm run dev:client
```

5. Open the application at [http://localhost:5173](http://localhost:5173).

The backend listens on `http://localhost:8000`, and FastAPI serves interactive
API documentation at `http://localhost:8000/docs`.

## Validation

Run the monorepo verification command:

```bash
npm run check
```

This checks the shared TypeScript contracts, builds the React frontend, and
compiles the FastAPI backend package.

## Security note

Do not commit real credentials, API keys, or personal secrets. Keep `.env`
local, use `.env.example` as the placeholder template, and rotate any secret if
it was ever exposed by mistake.
