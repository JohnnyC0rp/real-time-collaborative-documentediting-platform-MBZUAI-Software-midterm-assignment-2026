import type {
  AiActionAcceptedEvent,
  AiActionResult,
  AiActionStreamingEvent,
  AiHistoryResponse,
  AiInteractionRecord,
  ResolveAiInteractionRequest,
  SubmitAiActionRequest
} from "@collab/shared";
import { apiFetch, extractApiErrorMessage } from "./api";

interface AiStreamHandlers {
  onAccepted?: (event: AiActionAcceptedEvent) => void;
  onStreaming?: (event: AiActionStreamingEvent) => void;
  onResult?: (event: AiActionResult) => void;
  onFailed?: (message: string) => void;
  signal?: AbortSignal;
}

function parseEventBlock(block: string) {
  const lines = block.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  return {
    eventName,
    data: dataLines.length ? JSON.parse(dataLines.join("\n")) : null
  };
}

export async function streamAiAction(payload: SubmitAiActionRequest, handlers: AiStreamHandlers) {
  const response = await apiFetch("/api/ai/actions", {
    method: "POST",
    headers: {
      "Accept": "text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: handlers.signal
  });

  if (!response.ok) {
    throw new Error(await extractApiErrorMessage(response));
  }
  if (!response.body) {
    throw new Error("AI stream is unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
    const blocks = normalizedBuffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      if (!block.trim()) {
        continue;
      }

      const { eventName, data } = parseEventBlock(block);
      if (eventName === "accepted" && data) {
        handlers.onAccepted?.(data as AiActionAcceptedEvent);
      } else if (eventName === "streaming" && data) {
        handlers.onStreaming?.(data as AiActionStreamingEvent);
      } else if ((eventName === "complete" || eventName === "stale") && data) {
        handlers.onResult?.(data as AiActionResult);
      } else if (eventName === "failed" && data) {
        handlers.onFailed?.(data.error?.message ?? "AI request failed");
      }
    }

    if (done) {
      break;
    }
  }
}

export async function listAiHistory(
  documentId: string,
  filters?: {
    action?: string;
    resolution?: string;
    requested_by_user_id?: string;
    date_from?: string;
    date_to?: string;
  }
) {
  const searchParams = new URLSearchParams();
  if (filters?.action) {
    searchParams.set("action", filters.action);
  }
  if (filters?.resolution) {
    searchParams.set("resolution", filters.resolution);
  }
  if (filters?.requested_by_user_id) {
    searchParams.set("requested_by_user_id", filters.requested_by_user_id);
  }
  if (filters?.date_from) {
    searchParams.set("date_from", filters.date_from);
  }
  if (filters?.date_to) {
    searchParams.set("date_to", filters.date_to);
  }

  const query = searchParams.toString();
  const response = await apiFetch(`/api/ai/history/${documentId}${query ? `?${query}` : ""}`);
  if (!response.ok) {
    throw new Error(await extractApiErrorMessage(response));
  }

  return (await response.json()) as AiHistoryResponse;
}

export async function resolveAiInteraction(interactionId: string, payload: ResolveAiInteractionRequest) {
  const response = await apiFetch(`/api/ai/interactions/${interactionId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await extractApiErrorMessage(response));
  }

  return (await response.json()) as AiInteractionRecord;
}
