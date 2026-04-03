# Collaborative Document Editor PoC

This repo contains the current CRUD proof of concept for AI1220. It keeps the scope small on purpose: a Vue client, an Express API, PostgreSQL storage, and one shared TypeScript contract package.

## Included

- Document list and document editor screens
- `POST`, `GET`, `PUT`, and `DELETE` document endpoints
- Shared request and response types in `packages/shared`
- Seeded demo user support through `.env`
- Soft-delete support in the database schema

## Not Included Yet

- OAuth or full authentication flow
- Real-time collaboration
- AI actions
- Sharing UI, version history UI, or export flow

## Project Layout

```text
.
├── packages
│   ├── client
│   ├── server
│   └── shared
├── docker-compose.yml
└── .env.example
```

## Run Locally

1. Install dependencies.

```bash
npm install
```

2. Copy the example environment file.

```bash
cp .env.example .env
```

`DEMO_USER_ID` should match the seeded user in `packages/server/migrations/001_init.sql`.

3. Start PostgreSQL.

```bash
docker compose up -d
```

4. Run the migration.

```bash
npm run migrate
```

5. Start the backend.

```bash
npm run dev:server
```

6. Start the frontend in a second terminal.

```bash
npm run dev:client
```

Open `http://localhost:5173`. The API runs on `http://localhost:4000`.

## API Checks

Create a document:

```bash
curl -X POST http://localhost:4000/api/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"PoC demo doc"}'
```

List documents:

```bash
curl http://localhost:4000/api/documents
```

Load one document:

```bash
curl http://localhost:4000/api/documents/<DOCUMENT_ID>
```

Update a document:

```bash
curl -X PUT http://localhost:4000/api/documents/<DOCUMENT_ID> \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated title","content":"Updated content"}'
```

Delete a document:

```bash
curl -X DELETE http://localhost:4000/api/documents/<DOCUMENT_ID>
```

Invalid ID check:

```bash
curl http://localhost:4000/api/documents/not-a-real-id
```

Expected error response:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Document not found"
  }
}
```

## Validation

```bash
npm run check
```

## Notes

Keep `.env` local. Do not commit secrets, tokens, or personal credentials.
