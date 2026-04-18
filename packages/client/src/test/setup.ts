import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}

  unobserve() {}

  disconnect() {}
}

// jsdom does not ship this one, which is rude but consistent.
// We stub it once so component tests can focus on UI behavior instead.
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
