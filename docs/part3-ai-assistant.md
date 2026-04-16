# Part 3 notes

This branch only covers the writing-assistant work for Part 3. The assistant lives inside the document page and currently supports three actions: rewrite, summarize, and grammar cleanup. Rewrite includes tone options, summarize includes length options, and every run is streamed back to the browser so the user can see text arrive as it is generated.

The backend does not push the whole document into the prompt by default. It uses the current selection when there is one, otherwise it falls back to a trimmed document excerpt. Prompt templates are loaded from `packages/server/app/ai_prompts.json`, and the route talks to the model through a small provider layer so the app can run in `mock` mode locally or against an OpenAI-compatible endpoint later.

Each AI run is logged against the document with the prompt, source text, model name, response text, and final status. The document page shows that history under the assistant panel. Users can compare the original text and suggested text side by side, edit the suggestion before applying it, reject it, or undo the last accepted change.

For collaboration, suggestions are treated as draft edits against one document snapshot. When a suggestion is created, the client remembers the exact HTML it was based on. If the document changes before the user accepts the suggestion, the accept button is blocked and the user has to run the assistant again. That keeps one person from applying an old AI result over newer work from someone else.
