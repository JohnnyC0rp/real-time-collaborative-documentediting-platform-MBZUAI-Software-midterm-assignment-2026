import { useAuth } from "../context/AuthContext";

export function DashboardPage() {
  const auth = useAuth();

  return (
    <section className="panel">
      <h2>Dashboard</h2>
      <p>
        Signed in as <strong>{auth.user?.username}</strong>. The next frontend
        commit fills this page with document creation, role badges, and sharing
        metadata.
      </p>
    </section>
  );
}
