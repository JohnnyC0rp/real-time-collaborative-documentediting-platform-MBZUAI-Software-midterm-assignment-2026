import type { AuthSession, LoginRequest, RegisterRequest, UserProfile } from "@collab/shared";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { extractApiErrorMessage, publicFetch, setAccessToken, setRefreshHandler } from "../lib/api";

interface AuthContextValue {
  accessToken: string | null;
  user: UserProfile | null;
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  login: (payload: LoginRequest) => Promise<AuthSession>;
  register: (payload: RegisterRequest) => Promise<AuthSession>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AuthSession | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AuthSession>;
  return typeof candidate.access_token === "string" && typeof candidate.token_type === "string";
}

async function parseSession(response: Response): Promise<AuthSession> {
  const body = (await response.json()) as unknown;
  if (!isAuthSession(body)) {
    throw new Error("Server returned an invalid session payload");
  }

  return body;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const isSharedRoute =
    typeof window !== "undefined" && window.location.pathname.startsWith("/shared/");

  function applySession(nextSession: AuthSession | null) {
    setSession(nextSession);
    setAccessToken(nextSession?.access_token ?? null);
  }

  async function refreshSession(): Promise<AuthSession | null> {
    const response = await publicFetch("/api/auth/refresh", { method: "POST" });
    if (!response.ok) {
      applySession(null);
      return null;
    }

    const nextSession = await parseSession(response);
    applySession(nextSession);
    return nextSession;
  }

  async function login(payload: LoginRequest): Promise<AuthSession> {
    const response = await publicFetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await extractApiErrorMessage(response));
    }

    const nextSession = await parseSession(response);
    applySession(nextSession);
    return nextSession;
  }

  async function register(payload: RegisterRequest): Promise<AuthSession> {
    const response = await publicFetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await extractApiErrorMessage(response));
    }

    const nextSession = await parseSession(response);
    applySession(nextSession);
    return nextSession;
  }

  async function logout() {
    await publicFetch("/api/auth/logout", { method: "POST" });
    applySession(null);
  }

  useEffect(() => {
    setRefreshHandler(refreshSession);

    if (isSharedRoute) {
      // Public guest routes should not start with a predictable 401 chorus.
      setIsBootstrapping(false);
      return () => {
        setRefreshHandler(null);
        setAccessToken(null);
      };
    }

    void refreshSession().finally(() => {
      setIsBootstrapping(false);
    });

    return () => {
      setRefreshHandler(null);
      setAccessToken(null);
    };
  }, [isSharedRoute]);

  return (
    <AuthContext.Provider
      value={{
        accessToken: session?.access_token ?? null,
        user: session?.user ?? null,
        isBootstrapping,
        isAuthenticated: Boolean(session?.user),
        login,
        register,
        logout,
        refreshSession
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
