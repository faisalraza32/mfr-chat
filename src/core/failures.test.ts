import { describe, expect, it } from "vitest";

import { classifyFailure, visitorMessage } from "./failures.js";

function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

describe("classifyFailure", () => {
  it("recognises the credit-balance failure, which arrives as a 400", () => {
    // The real message seen in production when credits ran out.
    const failure = classifyFailure(
      apiError(
        400,
        "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
      )
    );

    expect(failure.kind).toBe("billing");
    expect(failure.urgent).toBe(true);
  });

  it("recognises DeepSeek's insufficient balance, which arrives as a 402", () => {
    const failure = classifyFailure(apiError(402, "Insufficient Balance"));

    expect(failure.kind).toBe("billing");
    expect(failure.urgent).toBe(true);
  });

  it("treats rejected keys as urgent", () => {
    expect(classifyFailure(apiError(401, "invalid x-api-key"))).toMatchObject({
      kind: "auth",
      urgent: true,
    });
    expect(classifyFailure(apiError(403, "forbidden"))).toMatchObject({
      kind: "auth",
      urgent: true,
    });
  });

  it("treats rate limits as transient", () => {
    expect(classifyFailure(apiError(429, "rate limited"))).toMatchObject({
      kind: "rate_limit",
      urgent: false,
    });
  });

  it("treats upstream 5xx as transient but a malformed 400 as urgent", () => {
    expect(classifyFailure(apiError(529, "overloaded"))).toMatchObject({
      kind: "upstream",
      urgent: false,
    });
    // A 400 we caused is a deploy bug — it will not fix itself.
    expect(
      classifyFailure(apiError(400, "invalid_request_error"))
    ).toMatchObject({
      kind: "upstream",
      urgent: true,
    });
  });

  it("handles non-Error values without throwing", () => {
    expect(classifyFailure("boom")).toMatchObject({ kind: "unknown" });
    expect(classifyFailure(undefined)).toMatchObject({ kind: "unknown" });
  });

  it("truncates long messages so the log and email stay readable", () => {
    const failure = classifyFailure(apiError(500, "x".repeat(2000)));
    expect(failure.message.length).toBe(500);
  });
});

describe("visitorMessage", () => {
  it("never reveals billing or key problems", () => {
    for (const error of [
      apiError(400, "Your credit balance is too low"),
      apiError(401, "invalid x-api-key"),
    ]) {
      const message = visitorMessage(classifyFailure(error));
      expect(message.toLowerCase()).not.toContain("credit");
      expect(message.toLowerCase()).not.toContain("key");
      expect(message.toLowerCase()).not.toContain("billing");
    }
  });

  it("tells the visitor to retry when we are merely busy", () => {
    const message = visitorMessage(
      classifyFailure(apiError(429, "rate limited"))
    );
    expect(message).toContain("try again");
  });

  it("uses the host's own copy when it supplies some", () => {
    const messages = {
      upstreamRateLimited: "Busy — one moment.",
      genericFailure: "Email us at hello@example.com.",
    };

    expect(
      visitorMessage(classifyFailure(apiError(429, "slow down")), messages)
    ).toBe("Busy — one moment.");
    expect(
      visitorMessage(classifyFailure(apiError(500, "boom")), messages)
    ).toBe("Email us at hello@example.com.");
  });
});
