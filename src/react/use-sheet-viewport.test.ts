// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSheetViewport } from "./use-sheet-viewport.js";

/**
 * The hook is what keeps the on-screen keyboard from pushing the close button
 * off the top of the mobile sheet, and jsdom implements neither visualViewport
 * nor matchMedia. These stubs stand in for both so the sizing decisions —
 * which are the part that can silently regress — are covered.
 */
interface FakeVisualViewport extends EventTarget {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
}

function stubViewport(matches: boolean, size: Partial<FakeVisualViewport> = {}) {
  const visual = Object.assign(new EventTarget(), {
    width: 375,
    height: 812,
    offsetTop: 0,
    offsetLeft: 0,
    ...size,
  }) as FakeVisualViewport;

  const media = Object.assign(new EventTarget(), {
    matches,
  }) as MediaQueryList & EventTarget;

  vi.stubGlobal("visualViewport", visual);
  vi.stubGlobal("matchMedia", () => media);

  /** Mimics the keyboard opening: the visual viewport shrinks, nothing else. */
  const resize = (next: Partial<FakeVisualViewport>) =>
    act(() => {
      Object.assign(visual, next);
      visual.dispatchEvent(new Event("resize"));
    });

  return { visual, resize };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSheetViewport", () => {
  it("reports the visual viewport on a phone", () => {
    stubViewport(true);

    const { result } = renderHook(() => useSheetViewport());

    expect(result.current).toEqual({
      width: 375,
      height: 812,
      offsetTop: 0,
      offsetLeft: 0,
    });
  });

  it("shrinks with the keyboard instead of keeping the layout height", () => {
    const { resize } = stubViewport(true);
    const { result } = renderHook(() => useSheetViewport());

    resize({ height: 482 });

    expect(result.current?.height).toBe(482);
  });

  it("follows the browser when it pans to reveal the caret", () => {
    const { resize } = stubViewport(true);
    const { result } = renderHook(() => useSheetViewport());

    resize({ height: 482, offsetTop: 120 });

    // Without this the sheet stays pinned to the layout viewport and its
    // header — with the close button — scrolls off the top of the screen.
    expect(result.current?.offsetTop).toBe(120);
  });

  it("hands layout back to CSS above the breakpoint", () => {
    stubViewport(false);

    const { result } = renderHook(() => useSheetViewport());

    expect(result.current).toBeNull();
  });

  it("ignores a zero size rather than collapsing the sheet", () => {
    const { resize } = stubViewport(true);
    const { result } = renderHook(() => useSheetViewport());

    resize({ width: 0, height: 0 });

    expect(result.current).toBeNull();
  });

  it("keeps the same object when nothing moved", () => {
    const { resize } = stubViewport(true);
    const { result } = renderHook(() => useSheetViewport());
    const first = result.current;

    // Keyboard animations fire these every frame; a new object each time would
    // re-render the whole message list along with them.
    resize({});

    expect(result.current).toBe(first);
  });
});
