import type { LoginRequest } from "@collab/shared";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formState, setFormState] = useState<LoginRequest>({
    identifier: "",
    password: ""
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (auth.isAuthenticated) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    return <Navigate to={from ?? "/dashboard"} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      await auth.login(formState);
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(from ?? "/dashboard", { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <h2>Login</h2>
      <p className="muted-copy">
        Access tokens stay in memory, refresh tokens stay in an HTTP-only
        cookie, and the client silently retries after refresh instead of
        dumping raw 401s on the screen.
      </p>

      <form className="stack-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Email or username</span>
          <input
            autoComplete="username"
            value={formState.identifier}
            onChange={(event) => {
              setFormState((currentState) => ({
                ...currentState,
                identifier: event.target.value
              }));
            }}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={formState.password}
            onChange={(event) => {
              setFormState((currentState) => ({
                ...currentState,
                password: event.target.value
              }));
            }}
          />
        </label>

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
          <Link className="secondary-link" to="/register">
            Need an account?
          </Link>
        </div>
      </form>
    </section>
  );
}
