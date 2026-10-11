# @mfr/chat

A chat assistant you can put on a website, split so that the parts worth
sharing are shared and the parts that are yours stay yours.

It runs today on two things that have almost nothing in common: a public
marketing site on Cloudflare Workers with D1 and a Turnstile captcha, and a
signed-in multi-tenant CRM on Next.js with Postgres and no captcha at all.
Neither knows about the other, and the package contains no trace of either.

```
@mfr/chat/core      the server half — providers, agent loop, sessions, SSE
@mfr/chat/react     the browser half — the panel, the hook, the storage rules
@mfr/chat/metadata  provider names and regions, carrying no SDK
```

---

## The idea

Two questions decide where a piece of this belongs.

**Is it hard to get right?** The focus trap. The `visualViewport` sizing that
stops a phone keyboard shoving the close button off screen. Deciding when a
returning visitor needs challenging again. Reassembling tool calls from a
stream. Keeping the cached prompt prefix byte-identical so the provider's cache
actually hits. All shared.

**Is it about your business?** The prompt. The tools. The colours, the router,
the icons, the captcha, what a booking button does. All yours, and all injected.

Everything the core cannot do by itself arrives as a **port** — a small
interface you implement. That is what lets one package serve a marketing site
and an internal application without either compromising.

---

## Installing

Published as a git dependency, so no registry is needed:

```bash
npm  install "@mfr/chat@git+ssh://git@github.com/faisalraza32/mfr-chat.git#v0.3.0"
pnpm add     "@mfr/chat@git+ssh://git@github.com/faisalraza32/mfr-chat.git#v0.3.0"
```

`dist/` is not committed; `prepare` builds on install. With pnpm that needs one
line in `pnpm-workspace.yaml`, because it blocks lifecycle scripts by default:

```yaml
allowBuilds:
  "@mfr/chat": true
```

**Bumping the tag in `package.json` is not enough.** Both lockfiles pin the
resolved commit, so changing `#v0.3.0` to `#v0.4.0` and running install gives
you the old code. Install the new spec explicitly.

React 18 or 19, as a peer. The core needs no React at all.

---

## The server half

One function turns a `Request` into a streaming `Response`. Both Cloudflare
Workers and Next route handlers speak the Fetch API, so the signature is the
same in either.

```ts
import { createProvider, handleChatRequest } from "@mfr/chat/core";

export async function POST(request: Request) {
  return handleChatRequest(request, {
    provider: () => createProvider({ id: "openai", apiKey: process.env.OPENAI_API_KEY! }),
    store: myStore,
    toolset: myTools,
    toolContext: { db },
    guardrails: GUARDRAILS,
    knowledge: KNOWLEDGE,
  });
}
```

That is the whole required surface. Everything else is optional.

### The ports

| Port | Required | What it is |
|---|---|---|
| `ChatStore` | yes | Conversation state, history, persistence |
| `ChatToolset` | yes — may be empty | What the assistant can call |
| `HumanVerifier` | no | A captcha. **Omit it and the challenge and session token disappear entirely** |
| `RateLimiter` | no | Per-IP throttling |
| `BackgroundTask` | no | `ctx.waitUntil` / `after()` |
| `FailureReporter` | no | Where operator alerts go |
| `logUsage` | no | Fires per model call, for metering a spend cap |

`HumanVerifier` being optional rather than stubbed is the one to notice. A
captcha in front of somebody who has already signed in is asking them to prove
it twice, so an authenticated app passes nothing and the whole challenge
mechanism is simply not there.

### Checking the reply before anybody sees it

`validateReply` is the last look at a finished reply. Return null to send it as
the model wrote it, or the text to send instead.

```ts
validateReply: (text) =>
  text.includes(SECRET_INSTRUCTIONS) ? "I can't share my instructions." : null,
```

It may be async, which is the point for a host whose replacement is *computed*
rather than canned — one that answers again from its own data, running tools to
do it. Nothing is sent until it has answered.

It costs the token-by-token stream: with a validator the reply is held until it
is whole, checked, and then sent in one piece. That is the point. A reply that
recites its own instructions, invents a price, or leaks a raw tool call has
done the damage the moment it is on screen — pulling it a second later is not
a fix. Short replies make this a second of typing dots, which is the trade.

Tool events are not held back, only text, and what the store records is what
was sent rather than what the model first wrote.

### Answering when the model cannot be reached

`fallbackReply` is the other half of that. When the provider is out of credit,
unreachable, or misconfigured, the core apologises — but a host with content of
its own can usually do better, because the opening hours are still the opening
hours when the provider is down.

```ts
fallbackReply: (message, failure) => answerFromOwnContent(message),
```

It may be async too, for the same reason. Return text and it is sent and
stored like an ordinary reply, so the conversation still reads if the next
message gets through. Return null and the
apology stands. The `failure` is there to answer differently for a billing
problem than for a timeout, if you want to.

### The one rule every `ChatStore` must keep

History lives in the store, never in the request body. If the browser sent the
transcript back each turn, anyone could post a fabricated 500k-token
conversation and bill you for it. The client sends only a conversation id.

### Conversation ids, and when they are dangerous

The browser generates the id. On an anonymous site that is harmless — the only
thread a visitor's id can name is their own.

**In an application where people share a workspace it is not.** A colleague can
send somebody else's id and append to their thread. If your store is for
signed-in users, scope the id rather than trusting it: make it unique per
(tenant, user) and never look it up alone. The CRM does this, and enforces it
in row-level security as well as in code.

### Providers

Anthropic, OpenAI, xAI and DeepSeek behind one interface. Switching is a config
change, not a code change.

```ts
createProvider({ id: "anthropic", apiKey, model: "claude-opus-5", workspaceId })
```

`@mfr/chat/metadata` carries the display names and processing regions with **no
SDK attached**, so a privacy page can name its processor without pulling two
model SDKs into the browser bundle. Use it, not the barrel, in client code.

**Cloudflare Workers AI** is the exception to "switching is a config change":
it is a runtime binding, not an API key, so it has a constructor of its own and
`createProvider` refuses it by name.

```ts
createWorkersAiProvider({ ai: env.AI })   // inside a Worker
```

`PROVIDER_KEY_NAMES["workers-ai"]` is therefore `null` — check
`providerNeedsKey(id)` before looking a key up in the environment.

It is an order of magnitude cheaper than the hosted APIs, and the open models
on it are correspondingly less disciplined: the adapter recovers tool calls the
model writes out as prose, and withholds the tool list once a result is in the
conversation, because Llama 3.3 otherwise asks for the same tool for ever. Both
were confirmed against the live API. There is also no token stream through a
binding, so the reply arrives whole — a page that renders deltas simply gets
one.

A sensible split for a multi-tenant product: Workers AI on a free tier, a
hosted model on a paid one. On a site where the assistant is the first
impression, pay for the better model.

### Prompt caching is the main cost lever

`guardrails` and `knowledge` are separate because the cache breakpoint goes
between them: knowledge is large and static, everything volatile sits after it.
Get this wrong and every message silently costs several times more while
looking perfectly fine. There is a test asserting no volatile content lands in
the cached prefix; keep it.

---

## The browser half

```tsx
import {
  ChatUIProvider, ChatLauncher, ChatPanel, useChat, createChatStorage,
} from "@mfr/chat/react";

const storage = createChatStorage("acme:chat");

<ChatUIProvider config={{
  Link: ({ to, ...rest }) => <Link href={to} {...rest} />,
  internalPathPrefixes: ["products", "support"],
  classNames: { bubbleUser: "bg-accent text-inverse" },
  Brand: () => <Logo className="h-full w-full" />,
}}>
  <ChatLauncher storage={storage} renderPanel={({ onClose }) => <MyPanel onClose={onClose} />} … />
</ChatUIProvider>
```

### What you inject, and why

| | |
|---|---|
| `Link` | The package cannot pick react-router or `next/link` without excluding the other |
| `internalPathPrefixes` | **Security.** See below |
| `classNames` | Defaults are shadcn's vocabulary; override the slots your design system names differently |
| `Brand` | A component, not a node, so a theme-aware logo can call a hook |
| `teaser` on `ChatLauncher` | A nudge beside the button a few seconds in, with a dismiss that sticks |
| `challenge` | Omit for an authenticated app |

### The link allow-list takes prefixes, never a pattern

This is what stands between model output and a router navigation. You name path
prefixes and the package builds the regex; prefixes that could widen the match
are rejected. Handing over a `RegExp` would move the guarantee to the caller,
where a plausible-looking mistake is silent — a stray `.*` is an off-site
redirect the assistant can be talked into emitting.

### The launcher teaser

`ChatLauncher` takes an optional `teaser` — a line of copy that appears beside
the button a few seconds after the page settles, with a close control. Omit it
and there is none.

Dismissing it is remembered **past the tab**, and a conversation that already
exists suppresses it: somebody who has used the assistant does not need selling
it. A bubble that returns on the next visit has not been dismissed, it has been
postponed, and that is the thing people mean when they say they hate chat
widgets.

### Authenticating the request

`useChat` calls `fetch`, so a cookie-authenticated app needs nothing — the
browser attaches those itself. An app holding a bearer token passes `headers`:

```ts
useChat({ copy, storage, headers: () => ({ Authorization: `Bearer ${token()}` }) })
```

A function, not an object: the token is usually refreshed while the panel is
open, and an object captured at mount keeps sending the one the page loaded
with, then starts failing silently an hour in.

### Storage

`createChatStorage(prefix)` namespaces `sessionStorage`, because two apps on one
origin would otherwise read each other's threads. sessionStorage rather than
local: a conversation belongs to the tab it started in.

The one exception is `readDurable` / `writeDurable`, backed by `localStorage`,
for the handful of things that are a *preference* rather than conversation
state. The teaser dismissal is the whole of that list today.

---

## Three things that will bite you

**Tailwind will not see the panel's classes.** They live in the package, and
Tailwind only scans what you tell it to. The build succeeds, every test passes,
and the panel renders completely unstyled.

```js
// Tailwind 3 — tailwind.config
content: [..., "./node_modules/@mfr/chat/dist/react/**/*.js"]
```
```css
/* Tailwind 4 — globals.css */
@source "../node_modules/@mfr/chat/dist/react/**/*.js";
```

**React can resolve twice.** Installed from a tag it will not — devDeps are
pruned, so the package carries no React of its own. `npm link` it to work on the
package and it does, and the second copy has a null hook dispatcher that fails
every render. `resolve.dedupe: ["react", "react-dom"]` in Vite, or the
equivalent, costs nothing and saves a confusing afternoon.

**Next needs the client boundary.** The components ship `"use client"`
directives already; you do not need to add them, but do not strip them.

---

## Wire compatibility

The request field is `challengeToken`, and `turnstileToken` is still accepted.
The error codes are still `turnstile_required` and `turnstile_failed` even where
no Turnstile exists. Renaming them would strand every browser tab already open
against an older client, which is a poor trade for tidiness.

---

## Two worked examples

**A public marketing site** (`ridasoftsolutions`) — Cloudflare Workers, D1 for
the store, Turnstile as the `HumanVerifier`, `ctx.waitUntil` as the
`BackgroundTask`, a rate-limit binding, and two tools: show a booking button,
send a message to the team. shadcn class names, so it overrides almost nothing.

**A signed-in multi-tenant CRM** (`cms-vb/crm`) — Next.js route handler,
Postgres through Prisma with row-level security, **no `HumanVerifier`**,
`after()` for background work, a monthly token budget metered through
`logUsage`, and tools that count and link but never read a customer record out.
Its own design tokens, so it overrides every class name. See
`docs/assistant.md` there.

---

## Development

```bash
npm install
npm test        # 135 tests, core on node and react on jsdom
npm run typecheck
npm run build
```

Releasing is a tag: bump `version`, commit, `git tag -a vX.Y.Z`, push with
`--tags`, then install the new spec in each consumer.
