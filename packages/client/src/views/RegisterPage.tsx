import type { RegisterRequest } from "@collab/shared";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [formState, setFormState] = useState<RegisterRequest>({
    username: "",
    email: "",
    password: ""
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (auth.isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      await auth.register(formState);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Registration failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <h2>Create account</h2>
      <p className="muted-copy">
        The backend stores only bcrypt hashes. Plaintext passwords get exactly
        zero permanent residency. A tragic loss for plaintext enthusiasts.
      </p>

      <form className="stack-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Username</span>
          <input
            autoComplete="username"
            value={formState.username}
            onChange={(event) => {
              setFormState((currentState) => ({
                ...currentState,
                username: event.target.value
              }));
            }}
          />
        </label>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={formState.email}
            onChange={(event) => {
              setFormState((currentState) => ({
                ...currentState,
                email: event.target.value
              }));
            }}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="new-password"
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
            {isSubmitting ? "Creating..." : "Create account"}
          </button>
          <Link className="secondary-link" to="/login">
            Already registered?
          </Link>
        </div>
      </form>
    </section>
  );
}
