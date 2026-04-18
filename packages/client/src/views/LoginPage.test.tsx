import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const authState = {
  isAuthenticated: false,
  login: vi.fn()
};

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    ...authState,
    accessToken: null,
    user: null,
    isBootstrapping: false,
    logout: vi.fn(),
    refreshSession: vi.fn(),
    register: vi.fn()
  })
}));

describe("LoginPage", () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.login.mockReset();
  });

  it("submits credentials and navigates to the dashboard", async () => {
    authState.login.mockResolvedValue({
      access_token: "access-token",
      token_type: "bearer",
      expires_at: "2026-04-18T12:30:00Z",
      user: {
        id: "user-1",
        username: "johnny",
        email: "johnny@example.com",
        created_at: "2026-04-18T12:00:00Z"
      }
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div>Dashboard landing</div>} />
        </Routes>
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/Email or username/i), "johnny");
    await userEvent.type(screen.getByLabelText(/Password/i), "password123");
    await userEvent.click(screen.getByRole("button", { name: /Sign in/i }));

    await waitFor(() => {
      expect(authState.login).toHaveBeenCalledWith({
        identifier: "johnny",
        password: "password123"
      });
    });
    expect(await screen.findByText("Dashboard landing")).toBeInTheDocument();
  });
});
