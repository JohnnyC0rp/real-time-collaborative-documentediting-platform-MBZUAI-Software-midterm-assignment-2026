# Architecture Deviations

This file records the concrete implementation choices that differ from the
earlier design and proof-of-concept direction, based on the shipped code in
this repository and the project history.

## 1. File-backed storage instead of a database

- **What changed:** The final backend persists users, documents, shares,
  versions, refresh sessions, and AI interaction history in
  `packages/server/data/app-data.json`.
- **Why:** The assignment explicitly allows file-based persistence, and a single
  JSON store keeps local setup simple for reviewers and the live demo.
- **Assessment:** Improvement for assignment delivery and local reproducibility;
  compromise for concurrency and production scaling.

## 2. Patch-based merge recovery instead of a full CRDT framework

- **What changed:** Real-time collaboration now rebases concurrent edits with a
  character-level patch merge and renders remote cursors and selections, but it
  still does not use a full CRDT or dedicated OT framework.
- **Why:** This keeps the FastAPI plus Tiptap architecture small enough for the
  assignment while still moving beyond last-write-wins data loss and covering
  the bonus collaboration behaviors.
- **Assessment:** Improvement over the earlier baseline because concurrent text
  changes now merge more gracefully and presence is richer; compromise compared
  with a production-grade CRDT stack.

## 3. SSE for AI generation and WebSockets only for document sync

- **What changed:** AI generation streams over SSE, while document
  collaboration uses a separate WebSocket channel.
- **Why:** SSE fits one-way token streaming cleanly, while WebSockets are the
  better fit for bidirectional live document updates and presence messages.
- **Assessment:** Improvement. The split keeps each transport aligned with its
  job and reduces unnecessary protocol complexity.

## 4. React plus FastAPI baseline replaced the earlier Vue plus Express proof of concept

- **What changed:** The repository history shows an earlier Vue plus Express
  proof-of-concept path, but the final implementation is React on the frontend
  and FastAPI on the backend.
- **Why:** The final stack matches the assignment technology constraints more
  directly and keeps the frontend and backend aligned with the required demo
  and API tooling.
- **Assessment:** Improvement. The final stack is closer to the assignment and
  easier to defend during technical Q&A.

## 5. Local fallback AI provider added alongside model-backed providers

- **What changed:** The final AI layer supports a deterministic local fallback
  provider in addition to OpenAI-compatible and Gemini providers.
- **Why:** This allows a full demo, tests, and UI validation without requiring
  paid API access or live credentials.
- **Assessment:** Improvement for reliability and reproducibility; compromise in
  output quality when running without a real model.
