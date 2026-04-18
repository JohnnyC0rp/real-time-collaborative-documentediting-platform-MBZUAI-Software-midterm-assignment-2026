# Part 3: AI Assistant Notes

The AI assistant lives inside the document page and supports four actions:
rewrite, summarize, translate, and restructure. Each request is scoped to the
current selection plus bounded surrounding context and a short heading outline.
The backend does not send the entire document blindly.

Prompt templates are loaded from `packages/server/app/ai/prompts/`. The route
talks to the model through a provider layer in
`packages/server/app/ai/provider.py`, so switching between the local fallback,
OpenAI-compatible APIs, and Gemini requires changes in one place.

Streaming is implemented with FastAPI `StreamingResponse` and SSE. The browser
renders the accepted event, token chunks, and the final result progressively.
Users can cancel an in-progress request. If the request was canceled after some
text already arrived, the partial draft is kept and labeled accordingly.

Suggestions remain review-first. The UI shows the original text at request
time, the proposal, optional segment-by-segment selection, and explicit apply
or reject actions. Users can edit the proposed text before applying it, and the
last accepted AI change can be undone as a new saved document version.

Every AI interaction is stored with the action type, requester, timestamps,
provider model id, prompt/response hashes, preview text, and final resolution.
Owners can filter document-specific AI history in the right sidebar.

During collaboration, AI requests are tied to the document version that existed
when generation started. If the relevant text changes before the result is
applied, the suggestion is marked as stale and must be reviewed against the
current selection before it can be committed.
