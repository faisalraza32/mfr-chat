import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest does not enable globals, so testing-library never registers its own
// auto-cleanup. Without this, renders pile up across tests in a file and
// queries start matching elements from earlier cases.
afterEach(cleanup);

// jsdom implements neither of these, and the panel uses both: matchMedia to
// decide between the mobile sheet and the floating card, visualViewport to
// size the sheet around the on-screen keyboard. Defaulting matchMedia to a
// non-match puts tests on the desktop path unless they say otherwise.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
