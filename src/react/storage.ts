/**
 * sessionStorage helpers shared by the launcher and the chat hook.
 *
 * These cover what React state does not: a real page load — an external link,
 * a typed URL, a refresh — where component state starts from nothing.
 *
 * sessionStorage rather than localStorage: a conversation belongs to the tab
 * it started in, and a new tab should start fresh.
 */

export interface ChatStorageKeys {
  conversation: string;
  session: string;
  messages: string;
  /** Epoch ms of the last message sent, for the idle rules in ./session. */
  activity: string;
  open: string;
}

export interface ChatStorage {
  keys: ChatStorageKeys;
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Namespaces the keys so two apps on the same origin — or an app and a
 * marketing site sharing a domain — cannot read each other's threads.
 */
export function createChatStorage(prefix: string): ChatStorage {
  const namespace = prefix.endsWith(":") ? prefix : `${prefix}:`;

  return {
    keys: {
      conversation: `${namespace}conversation`,
      session: `${namespace}session`,
      messages: `${namespace}messages`,
      activity: `${namespace}activity`,
      open: `${namespace}open`,
    },

    read(key) {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        // Private mode or blocked site data — the chat still works, it just
        // won't survive a navigation.
        return null;
      }
    },

    write(key, value) {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        // Ignore — see read.
      }
    },

    remove(key) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Ignore — see read.
      }
    },
  };
}
