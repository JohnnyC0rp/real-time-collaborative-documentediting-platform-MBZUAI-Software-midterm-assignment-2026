import { createBrowserRouter, NavLink, Outlet } from "react-router-dom";
import { DashboardPage } from "./views/DashboardPage";
import { DocumentPage } from "./views/DocumentPage";
import { LoginPage } from "./views/LoginPage";
import { RegisterPage } from "./views/RegisterPage";

function RootLayout() {
  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Assignment 2 foundation</p>
          <h1>Collaborative Document Editor</h1>
          <p className="hero-copy">
            React + FastAPI replaces the assignment-1 Vue + Express PoC. The
            core auth, document, and sharing flows arrive in the next commits.
          </p>
        </div>

        <nav className="hero-nav" aria-label="Primary">
          <NavLink to="/login">Login</NavLink>
          <NavLink to="/register">Register</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>
      </header>

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
      { path: "dashboard", element: <DashboardPage /> },
      { path: "documents/:documentId", element: <DocumentPage /> }
    ]
  }
]);
