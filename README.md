# Collaborative Document Editor PoC

This repository contains the Assignment 1 proof-of-concept for AI1220.  
It demonstrates a minimal but working end-to-end flow:

- Vue frontend (`packages/client`) with:
  - Document List page
  - Document Editor page
- Express backend (`packages/server`) with:
  - `POST /api/documents`
  - `GET /api/documents`
  - `GET /api/documents/:id`
  - `PUT /api/documents/:id`
  - `DELETE /api/documents/:id`
- PostgreSQL schema and migration with required `users` and `documents` columns
- Shared TypeScript contracts (`packages/shared`) imported by both frontend and backend

## What This PoC Demonstrates

- Frontend-to-backend communication through meaningful API calls.
- Data contracts that match the architecture-aligned PoC reference:
  - snake_case document fields (`owner_id`, `created_at`, `updated_at`)
  - list shape: `{ "documents": [...], "total": N }`
  - error shape: `{ "error": { "code": "...", "message": "..." } }`
- Monorepo layout using npm workspaces.

## What This PoC Intentionally Does Not Implement Yet

- Authentication or OAuth login flow (uses a seeded hardcoded test user).
- Real-time collaboration (WebSocket/CRDT).
- AI orchestration, version history UI, sharing/permissions UI.

## Project Structure

```text
.
├── packages
│   ├── client
│   │   └── src
│   │       ├── components
│   │       ├── services
│   │       └── views
│   ├── server
│   │   ├── migrations
│   │   └── src
│   │       ├── middleware
│   │       ├── models
│   │       ├── routes
│   │       └── utils
│   └── shared
│       └── src
├── docker-compose.yml
└── .env.example
```

## Prerequisites

- Node.js 20+
- npm 10+
- Docker (recommended for local PostgreSQL)

## Setup and Run

1. Install dependencies:

```bash
npm install
```

2. Create local environment file:

```bash
cp .env.example .env
```

3. Start PostgreSQL:

```bash
docker compose up -d
```

4. Run database migration:

```bash
npm run migrate
```

5. Start backend API:

```bash
npm run dev:server
```

6. In another terminal, start frontend:

```bash
npm run dev:client
```

7. Open:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## Quick API Contract Checks

Create document:

```bash
curl -X POST http://localhost:4000/api/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"PoC demo doc"}'
```

List documents:

```bash
curl http://localhost:4000/api/documents
```

Get one document:

```bash
curl http://localhost:4000/api/documents/<DOCUMENT_ID>
```

Update document:

```bash
curl -X PUT http://localhost:4000/api/documents/<DOCUMENT_ID> \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated title","content":"Updated content"}'
```

Delete document:

```bash
curl -X DELETE http://localhost:4000/api/documents/<DOCUMENT_ID>
```

Invalid ID contract check:

```bash
curl http://localhost:4000/api/documents/not-a-real-id
```

Expected error shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Document not found"
  }
}
```

## Type and Build Validation

Run:

```bash
npm run check
```

## Security Note

Do not commit real credentials, API tokens, or personal secrets.  
Use `.env.example` as template and keep `.env` local only.
