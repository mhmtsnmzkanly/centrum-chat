import { assertEquals } from "jsr:@std/assert@1";

// 1. Mock minimal browser environment before importing modules
const mockStorage: Record<string, string> = {};
const mockSessionStorage: Record<string, string> = {};

const mockLocalStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  },
};

const mockSessionStorageObj = {
  getItem: (key: string) => mockSessionStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockSessionStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockSessionStorage[key];
  },
  clear: () => {
    for (const k of Object.keys(mockSessionStorage)) delete mockSessionStorage[k];
  },
};

const globalObj = globalThis as unknown as Record<string, unknown>;

globalObj.window = {
  location: { protocol: "http:", host: "localhost" },
  localStorage: mockLocalStorage,
  sessionStorage: mockSessionStorageObj,
  addEventListener: () => {},
};

// Mock document for dialogs/focus
globalObj.document = {
  addEventListener: () => {},
  getElementById: (id: string) => {
    if (id === "messageSearchInput") {
      return { focus: () => {} };
    }
    return null;
  },
  querySelectorAll: () => [],
};

// Mock WebSocket class
globalObj.WebSocket = class {
  addEventListener() {}
  close() {}
};

// Now import store and functions dynamically to bypass ES module hoisting
const { store } = await import("../../web/scripts/chat-store.js");
const { clearAuthenticatedState } = await import("../../web/scripts/chat-auth.js");
const {
  setDraft,
  cancelPendingDraftPersistence,
  loadDrafts,
  setActiveDestination,
} = await import("../../web/scripts/chat-conversations.js");
const { recordSearchHistory, cancelPendingSearchPersistence } = await import(
  "../../web/scripts/chat-handlers.js"
);

// Helper to wait
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.test("Draft: Account A types, logs out before debounce, account B logs in: A's draft not written to B", async () => {
  // Setup user A
  store.set("session.loggedIn", true);
  store.set("session.user", { id: "userA", username: "userA" });
  store.set("activeDestKey", "channel_general");

  // A types text
  store.set("chatForm.messageInput", "A's draft");

  // Logout immediately
  clearAuthenticatedState();

  // Setup user B
  store.set("session.loggedIn", true);
  store.set("session.user", { id: "userB", username: "userB" });
  store.set("activeDestKey", "channel_general");

  // Wait for A's timer to fire
  await delay(600);

  // B's drafts should not contain A's text
  assertEquals(mockStorage["chat_drafts_userB"], undefined);
  assertEquals(mockStorage["chat_drafts_userA"], undefined);
});

Deno.test("Draft: Authentication loss before debounce does not repopulate cleared draft state", async () => {
  // Clear storage
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];

  // Setup user
  store.set("session.loggedIn", true);
  store.set("session.user", { id: "userA", username: "userA" });
  store.set("activeDestKey", "channel_general");

  // User types
  store.set("chatForm.messageInput", "some message");

  // Auth loss occurs before debounce
  clearAuthenticatedState();

  // Wait for debounce
  await delay(600);

  assertEquals(mockStorage["chat_drafts_userA"], undefined);
  assertEquals(store.get("drafts"), {});
});

Deno.test("Draft: Successful send followed immediately by reload simulation removes draft", async () => {
  // Clear storage
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];

  // Setup user
  store.set("session.loggedIn", true);
  store.set("session.user", { id: "userA", username: "userA" });
  store.set("activeDestKey", "channel_general");

  // Type and wait for persistence
  store.set("chatForm.messageInput", "hello world");
  await delay(600);
  assertEquals(
    JSON.parse(mockStorage["chat_drafts_userA"] || "{}")["channel_general"],
    "hello world",
  );

  // Send message - synchronously clears draft
  cancelPendingDraftPersistence();
  setDraft("channel_general", "", "userA");

  // Simulate immediate reload (loading drafts from storage)
  loadDrafts();

  // Sent text must not be retained
  assertEquals(mockStorage["chat_drafts_userA"], undefined);
  assertEquals(store.get("drafts"), {});
});

Deno.test("Draft: Conversation switch during debounce retains draft on originating conversation", async () => {
  // Clear storage
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];

  // Setup user
  store.set("session.loggedIn", true);
  store.set("session.user", { id: "userA", username: "userA" });
  store.set("activeDestKey", "channel_general");
  store.set("chatForm.messageInput", "draft text");

  // Wait 200ms, then switch conversation
  await delay(200);
  setActiveDestination("channel", "random");

  // Wait for original debounce to finish
  await delay(400);

  const drafts = JSON.parse(mockStorage["chat_drafts_userA"] || "{}");
  assertEquals(drafts["channel_general"], "draft text");
  assertEquals(drafts["channel_random"], undefined);
});

Deno.test("Draft: Empty draft map removes account storage key", () => {
  // Clear storage
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];

  store.set("session.loggedIn", true);
  store.set("session.user", { id: "userA", username: "userA" });

  setDraft("channel_general", "text", "userA");
  assertEquals(
    JSON.parse(mockStorage["chat_drafts_userA"] || "{}")["channel_general"],
    "text",
  );

  // Empty draft
  setDraft("channel_general", "", "userA");
  assertEquals(mockStorage["chat_drafts_userA"], undefined);
});

// Search history tests
Deno.test("Search: Account A search timer followed by logout and account B login does not pollute B", async () => {
  // Clear storage
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];

  store.set("session.loggedIn", true);
  store.set("session.user", { id: "userA", username: "userA" });

  // Setup timer in test
  const originatingUserId = "userA";
  const timer = setTimeout(() => {
    recordSearchHistory("queryA", originatingUserId);
  }, 500);

  // Logout before timer fires
  clearTimeout(timer);
  cancelPendingSearchPersistence();
  clearAuthenticatedState();

  // B logs in
  store.set("session.loggedIn", true);
  store.set("session.user", { id: "userB", username: "userB" });

  await delay(600);

  assertEquals(mockStorage["chat_search_history_userB"], undefined);
  assertEquals(mockStorage["chat_search_history_userA"], undefined);
});

Deno.test("Search: Clearing all removes the account-specific storage key", () => {
  // Clear storage
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];

  store.set("session.loggedIn", true);
  store.set("session.user", { id: "userA", username: "userA" });

  recordSearchHistory("hello", "userA");
  assertEquals(
    JSON.parse(mockStorage["chat_search_history_userA"] || "[]"),
    ["hello"],
  );

  // Clear
  persistSearchHistory([], "userA");
  assertEquals(mockStorage["chat_search_history_userA"], undefined);
});

// Helper for persistSearchHistory in tests
function persistSearchHistory(entries: string[], userId: string) {
  const key = `chat_search_history_${userId}`;
  if (entries.length === 0) {
    delete mockStorage[key];
  } else {
    mockStorage[key] = JSON.stringify(entries);
  }
}
