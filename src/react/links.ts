/**
 * Splits assistant text so bare site paths and URLs become links.
 *
 * The system prompt tells the model to write plain text, so a markdown
 * renderer would be a dependency earning nothing — this covers the one case
 * that actually comes up.
 *
 * SECURITY: this pattern is what stands between model output and a router
 * link, so it is deliberately an allow-list, and hosts configure it by naming
 * path prefixes rather than by supplying a pattern of their own. Internal
 * paths must begin with one of the named sections and may contain only
 * lowercase letters, digits, hyphens and forward slashes. That excludes
 * backslashes and a second leading slash, both of which routers have
 * historically turned into off-site redirects (GHSA-wrjc-x8rr-h8h6), and it
 * means a visitor cannot talk the assistant into emitting a link that leaves
 * the site.
 *
 * Handing over a RegExp instead would move that guarantee to the caller, where
 * a plausible-looking pattern gets it wrong quietly. See links.test.ts.
 */

/**
 * An absolute URL, stopping before any sentence punctuation it ends on.
 *
 * The last character may not be `.,;:!?` — otherwise a URL written where it
 * belongs, at the end of a sentence, swallows the full stop and the final
 * query parameter arrives as `travelmode=driving.` A closing bracket is
 * excluded outright for the same reason: prose puts links in parentheses.
 */
const ABSOLUTE = "https?:\\/\\/[^\\s)]*[^\\s).,;:!?]";

/** Rejects anything that could widen the pattern beyond a path segment. */
const SAFE_PREFIX = /^[a-z0-9][a-z0-9-]*$/;

export function buildLinkPattern(internalPathPrefixes: string[]): RegExp {
  const safe = internalPathPrefixes.filter((prefix) => SAFE_PREFIX.test(prefix));

  if (safe.length !== internalPathPrefixes.length) {
    const rejected = internalPathPrefixes.filter(
      (prefix) => !SAFE_PREFIX.test(prefix)
    );

    throw new Error(
      `Unsafe chat link prefix: ${rejected.join(", ")}. Use lowercase ` +
        `letters, digits and hyphens — this list is an allow-list guarding ` +
        `what the model can turn into a link.`
    );
  }

  if (safe.length === 0) {
    // Absolute URLs only. An app with no public sections to link into is a
    // perfectly ordinary case.
    return new RegExp(`(${ABSOLUTE})`, "gi");
  }

  return new RegExp(
    `(${ABSOLUTE}|\\/(?:${safe.join("|")})[a-z0-9/-]*)`,
    "gi"
  );
}

export type LinkKind = "internal" | "external";

export interface TextSegment {
  text: string;
  kind: "text" | LinkKind;
}

/** Splits text into plain runs and the links between them, in order. */
export function splitLinkedText(text: string, pattern: RegExp): TextSegment[] {
  // A global regex carries lastIndex between calls; split() does not use it,
  // but a fresh instance keeps this safe against future edits.
  const parts = text.split(new RegExp(pattern.source, pattern.flags));

  return parts.map((part, index) => {
    if (index % 2 === 0) {
      return { text: part, kind: "text" as const };
    }

    return {
      text: part,
      kind: part.startsWith("http") ? ("external" as const) : ("internal" as const),
    };
  });
}
