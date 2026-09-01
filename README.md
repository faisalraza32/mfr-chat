# @mfr/chat

The runtime-agnostic half of the site chat assistant, extracted from
`ridasoftsolutions` so a second application can run the same assistant without
inheriting Cloudflare.

## What is in `@mfr/chat/core`

| Area | What you get |
| --- | --- |
| Providers | Anthropic, OpenAI, xAI and DeepSeek behind one `ChatProvider` interface, including the Anthropic cache breakpoint and the OpenAI streaming tool-call reassembly |
| Agent loop | `runChatTurn` — streams text, runs tools, bounded iterations, near-the-cap wrap-up steer |
| Handler | `handleChatRequest(request, deps)` — a `Request` in, a streaming SSE `Response` out |
| Sessions | HMAC tokens over Web Crypto: issue, verify, slide-before-expiry |
| Validation | `parseChatRequest` — UUID conversation ids, capped message length |
| Failures | `classifyFailure` — tells billing from auth from transient, decides what is worth an alert |
| SSE | `encodeEvent`, `SSE_HEADERS` |

## What is deliberately not in it

No database, no bot check, no email, no prompt, no tools, no UI. Those differ
between a public marketing site and an authenticated application, so they
arrive through ports:

| Port | Required | Purpose |
| --- | --- | --- |
| `ChatStore` | yes | Conversation state, history, persistence |
| `ChatToolset` | yes (may be empty) | The tools the assistant can call |
| `HumanVerifier` | no | Omit to skip the challenge and the session token entirely |
| `RateLimiter` | no | Per-IP throttling |
| `BackgroundTask` | no | `ctx.waitUntil` / `after()` |
| `FailureReporter` | no | Where operator alerts go |

### The one rule every `ChatStore` must keep

History lives in the store, never in the client payload. If the browser sent
the transcript back on each turn, anyone could post a fabricated 500k-token
conversation and bill you for it. The client sends only a conversation id.

## Wiring it up — Cloudflare Worker

```ts
import { createProvider, handleChatRequest } from "@mfr/chat/core";

export async function handleChatPost(
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContext
) {
  return handleChatRequest(request, {
    provider: () =>
      createProvider({ id: "openai", apiKey: env.OPENAI_API_KEY }),
    store: createD1Store(env.DB),
    toolset: siteToolset,
    toolContext: { env },
    guardrails: GUARDRAILS,
    knowledge: KNOWLEDGE_BLOCK,
    sessionSecret: env.CHAT_SESSION_SECRET,
    verifyHuman: (token, ip) =>
      verifyTurnstileToken(token, env.TURNSTILE_SECRET_KEY, ip),
    rateLimiter: { isLimited: (key) => isRateLimited(env, key) },
    runInBackground: (work) => ctx.waitUntil(work),
    reportFailure: (failure) => ctx.waitUntil(recordChatFailure(env, failure)),
    preflight: () => findMissingSecret(env),
    messages: { genericFailure: `Something went wrong. Email ${INBOX}.` },
  });
}
```

## Wiring it up — Next.js route handler

Behind authentication there is no challenge to run, so `verifyHuman` and
`sessionSecret` come off and the session token disappears with them.

```ts
// app/api/chat/route.ts
import { after } from "next/server";
import { createProvider, handleChatRequest } from "@mfr/chat/core";

export async function POST(request: Request) {
  const user = await requireUser();

  return handleChatRequest(request, {
    provider: () =>
      createProvider({ id: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY! }),
    store: createPrismaStore(prisma, user.workspaceId),
    toolset: crmToolset,
    toolContext: { prisma, user },
    guardrails: CRM_GUARDRAILS,
    knowledge: await buildWorkspaceKnowledge(user.workspaceId),
    runInBackground: (work) => after(work),
    limits: { maxMessagesPerConversation: 100 },
  });
}
```

## Wire compatibility

The request field is `challengeToken`, but `turnstileToken` is still accepted,
and the error codes are still `turnstile_required` / `turnstile_failed`. A
browser built against the original Cloudflare-only client works against this
package unchanged — renaming them would have stranded every open tab.

## Not extracted yet

The browser half. `parse-stream`, the client-side session policy, and the
`sessionStorage` helpers are all pure and will lift cleanly; the React panel
needs its `react-router` imports and its Tailwind class vocabulary injected
before it can run in a Next app. That is the next package, `@mfr/chat/react`.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```
