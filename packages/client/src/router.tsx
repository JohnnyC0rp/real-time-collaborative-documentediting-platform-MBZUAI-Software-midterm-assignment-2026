import { createBrowserRouter, Navigate, NavLink, Outlet } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import { DashboardPage } from "./views/DashboardPage";
import { DocumentPage } from "./views/DocumentPage";
import { LoginPage } from "./views/LoginPage";
import { RegisterPage } from "./views/RegisterPage";

function RootLayout() {
  const auth = useAuth();

  async function handleLogout() {
    await auth.logout();
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Assignment 2 foundation</p>
          <h1>Collaborative Document Editor</h1>
          <p className="hero-copy">
            Core application work in progress: protected sessions are live, and
            the document experience is being layered on top without dropping the
            assignment-1 repo history.
          </p>
        </div>

        <nav className="hero-nav" aria-label="Primary">
          {!auth.isAuthenticated ? (
            <>
              <NavLink to="/login">Login</NavLink>
              <NavLink to="/register">Register</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/dashboard">Dashboard</NavLink>
              <button className="ghost-button" type="button" onClick={handleLogout}>
                Logout
              </button>
            </>
          )}
        </nav>
      </header>

      {auth.isAuthenticated ? (
        <section className="session-banner">
          <strong>{auth.user?.username}</strong>
          <span>{auth.user?.email}</span>
        </section>
      ) : null}

      <Outlet />
    </main>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <LoginPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      {
        path: "dashboard",
        element: (
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        )
      },
      {
        path: "documents/:documentId",
        element: (
          <ProtectedRoute>
            <DocumentPage />
          </ProtectedRoute>
        )
      },
      { path: "*", element: <Navigate to="/" replace /> }
    ]
  }
]);
