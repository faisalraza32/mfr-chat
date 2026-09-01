/**
 * Chat session tokens.
 *
 * A human check challenges the visitor once, on the first message.
 * Re-challenging every turn would be unusable, so a successful check mints an
 * HMAC token bound to that conversation id and a short expiry. Subsequent
 * messages present the token instead of a fresh challenge.
 *
 * The token proves "this conversation passed a human check recently". It is
 * not an identity or an authorisation, and it carries nothing secret.
 *
 * Web Crypto only, so this runs unchanged on workerd, Node 20+ and Deno.
 */
import { DEFAULT_SESSION, type SessionOptions } from "./config.js";

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Returns the raw ArrayBuffer rather than a view: since TypeScript 5.7 a
 * `Uint8Array` is generic over its backing buffer, and one built from
 * `Uint8Array.from` widens to `ArrayBufferLike`, which `crypto.subtle.verify`
 * will not accept. Allocating the buffer here keeps the type exact.
 */
function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export interface IssueOptions {
  ttlMs?: number;
  now?: number;
}

export async function issueSessionToken(
  secret: string,
  conversationId: string,
  options: IssueOptions = {}
): Promise<string> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION.ttlMs;
  const expiresAt = now + ttlMs;
  const payload = `${conversationId}.${expiresAt}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return `${payload}.${toBase64Url(signature)}`;
}

/**
 * Whether a token that has already verified is close enough to its expiry to
 * be reissued. Reading the expiry off a verified token is safe: the signature
 * covers it.
 */
export function shouldRefreshSessionToken(
  token: string,
  options: { refreshBeforeMs?: number; now?: number } = {}
): boolean {
  const now = options.now ?? Date.now();
  const refreshBeforeMs =
    options.refreshBeforeMs ?? DEFAULT_SESSION.refreshBeforeMs;
  const expiresAt = Number(token.split(".")[1]);

  return !Number.isFinite(expiresAt) || expiresAt - now <= refreshBeforeMs;
}

export async function verifySessionToken(
  secret: string,
  token: string,
  conversationId: string,
  now = Date.now()
): Promise<boolean> {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [tokenConversationId, expiresAtRaw, signature] = parts;

  if (tokenConversationId !== conversationId) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);

  if (!Number.isFinite(expiresAt) || expiresAt < now) {
    return false;
  }

  const key = await importKey(secret);

  // crypto.subtle.verify is constant-time, so this doesn't leak the signature
  // through timing the way a string comparison would.
  return crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signature),
    new TextEncoder().encode(`${tokenConversationId}.${expiresAtRaw}`)
  );
}

/**
 * The expiry the host signed into `conversationId.expiresAt.signature`, or
 * null if this is not a token shaped like one.
 *
 * Reading the expiry is not trusting it: the signature covers it, so a
 * tampered value fails verification server-side. A browser uses this only to
 * avoid a round trip it already knows will be rejected.
 */
export function readSessionExpiry(
  token: string | null | undefined
): number | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const expiresAt = Number(parts[1]);

  return Number.isFinite(expiresAt) ? expiresAt : null;
}

export type { SessionOptions };
