import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { DocumentSummary } from "@collab/shared";
import { RoleBadge } from "../components/RoleBadge";
import { createDocument, listDocuments } from "../lib/documents";

export function DashboardPage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [title, setTitle] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadDocuments() {
      try {
        const response = await listDocuments();
        if (isMounted) {
          setDocuments(response.documents);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load documents");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadDocuments();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleCreateDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsCreating(true);

    try {
      const document = await createDocument({ title });
      navigate(`/documents/${document.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create document");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section className="panel">
      <h2>Dashboard</h2>
      <p className="muted-copy">
        Your accessible documents live here, with role badges and owner
        metadata straight from the protected API.
      </p>

      <form className="create-document-row" onSubmit={handleCreateDocument}>
        <input
          placeholder="Untitled strategy memo"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button className="primary-button" type="submit" disabled={isCreating || !title.trim()}>
          {isCreating ? "Creating..." : "New document"}
        </button>
      </form>

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      {isLoading ? <p className="muted-copy">Loading documents...</p> : null}

      {!isLoading && documents.length === 0 ? (
        <p className="muted-copy">No documents yet. Create one to start the core workflow.</p>
      ) : null}

      <div className="document-grid">
        {documents.map((document) => (
          <article key={document.id} className="document-card">
            <div className="document-card-header">
              <RoleBadge role={document.role} />
              <span>{new Date(document.updated_at).toLocaleString()}</span>
            </div>
            <h3>{document.title}</h3>
            <p>
              Owner: <strong>{document.owner.username}</strong>
            </p>
            <Link className="secondary-link" to={`/documents/${document.id}`}>
              Open document
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
