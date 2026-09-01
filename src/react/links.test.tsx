// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatMessageBubble } from "./ChatMessageBubble.js";
import { ChatUIProvider } from "./context.js";
import { buildLinkPattern, splitLinkedText } from "./links.js";

/**
 * Assistant text becomes a router link, so this is model output reaching a
 * navigation primitive. The link pattern is the boundary; these lock it down.
 */
const PREFIXES = ["services", "blog", "about", "privacy", "terms"];

function renderAssistant(text: string) {
  return render(
    <ChatUIProvider config={{ internalPathPrefixes: PREFIXES }}>
      <ChatMessageBubble role="assistant" text={text} />
    </ChatUIProvider>
  );
}

describe("links in assistant messages", () => {
  it("links real site paths", () => {
    renderAssistant("See /blog/how-apps-increase-customer-engagement-and-sales");

    expect(
      screen.getByRole("link", {
        name: "/blog/how-apps-increase-customer-engagement-and-sales",
      })
    ).toHaveAttribute(
      "href",
      "/blog/how-apps-increase-customer-engagement-and-sales"
    );
  });

  it("opens external links in a new tab without leaking the referrer", () => {
    renderAssistant("Book at https://calendly.com/ridasoftsolutions/30min");

    const link = screen.getByRole("link");

    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not turn a backslash path into a link", () => {
    // Routers have treated /\host as an off-site redirect
    // (GHSA-wrjc-x8rr-h8h6). The pattern must never produce one.
    renderAssistant("Go to /\\evil.example.com now");

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not turn a protocol-relative path into a link", () => {
    renderAssistant("Go to //evil.example.com now");

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not link an arbitrary path outside the known sections", () => {
    renderAssistant("Try /admin/secret or /../../etc/passwd");

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not link a javascript: URL", () => {
    renderAssistant("Click javascript:alert(1) here");

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders text with no link as plain text", () => {
    renderAssistant("We build mobile apps.");

    expect(screen.getByText("We build mobile apps.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not link a section it was not given", () => {
    // The allow-list is per host: an app that never published /blog must not
    // inherit this site's sections.
    render(
      <ChatUIProvider config={{ internalPathPrefixes: ["dashboard"] }}>
        <ChatMessageBubble role="assistant" text="See /blog/post and /dashboard/x" />
      </ChatUIProvider>
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/dashboard/x");
  });
});

describe("buildLinkPattern", () => {
  it("refuses a prefix that could widen the pattern", () => {
    // Taking a RegExp from the host would move this guarantee to the caller,
    // where a plausible-looking pattern gets it wrong quietly.
    for (const bad of [".*", "blog|admin", "a/b", "(x)", "\\d", "UPPER"]) {
      expect(() => buildLinkPattern([bad])).toThrow(/Unsafe chat link prefix/);
    }
  });

  it("matches absolute URLs only when given no prefixes", () => {
    const pattern = buildLinkPattern([]);
    const segments = splitLinkedText("see /blog/x and https://a.example", pattern);

    expect(segments.filter((s) => s.kind !== "text")).toEqual([
      { text: "https://a.example", kind: "external" },
    ]);
  });

  it("classifies internal and external segments in order", () => {
    const pattern = buildLinkPattern(["services"]);
    const segments = splitLinkedText(
      "Try /services/web then https://x.example done",
      pattern
    );

    expect(segments.map((s) => s.kind)).toEqual([
      "text",
      "internal",
      "text",
      "external",
      "text",
    ]);
  });
});
