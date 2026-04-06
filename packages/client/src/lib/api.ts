import type { ApiErrorResponse, AuthSession } from "@collab/shared";

type RefreshHandler = () => Promise<AuthSession | null>;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

let accessToken: string | null = null;
let refreshHandler: RefreshHandler | null = null;
let refreshInFlight: Promise<AuthSession | null> | null = null;

export function setAccessToken(nextAccessToken: string | null) {
  accessToken = nextAccessToken;
}

export function setRefreshHandler(nextRefreshHandler: RefreshHandler | null) {
  refreshHandler = nextRefreshHandler;
}

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

async function refreshOnce(): Promise<AuthSession | null> {
  if (!refreshHandler) {
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = refreshHandler().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

export async function publicFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include"
  });
}

export async function apiFetch(path: string, init?: RequestInit, allowRefresh = true): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: "include"
  });

  if (response.status !== 401 || !allowRefresh || path.startsWith("/api/auth/")) {
    return response;
  }

  const nextSession = await refreshOnce();
  if (!nextSession) {
    return response;
  }

  return apiFetch(path, init, false);
}

export async function extractApiErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    return payload.error?.message ?? "Request failed";
  } catch {
    return "Request failed";
  }
}
