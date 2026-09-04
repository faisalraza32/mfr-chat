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

/**
 * jsdom provides `localStorage`; Node 26 provides one of its own that is
 * `undefined` unless the process was started with `--localstorage-file`, and
 * the global that wins here is Node's. So the durable half of `ChatStorage`
 * has nothing to write to unless one is put back.
 *
 * Defined only when it is missing, so this disappears the day the shadowing
 * does. The package itself needs no such help — `readDurable` and
 * `writeDurable` are wrapped, and a missing store there means a teaser shows
 * again, which is the harmless way for it to fail.
 */
if (typeof window.localStorage === "undefined") {
  const entries = new Map<string, string>();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return entries.size;
      },
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, String(value)),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    } satisfies Storage,
  });
}
