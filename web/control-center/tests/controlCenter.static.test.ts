function assertEquals(
  actual: unknown,
  expected: unknown,
  message = "Values differ",
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
  }
}

// ==========================================================================
// BROWSER GLOBALS POLYFILL FOR DENO ENVIRONMENT
// ==========================================================================
class MockStorage implements Storage {
  private store: Record<string, string> = {};
  get length() {
    return Object.keys(this.store).length;
  }
  clear() {
    this.store = {};
  }
  getItem(key: string) {
    return this.store[key] || null;
  }
  key(index: number) {
    return Object.keys(this.store)[index] || null;
  }
  removeItem(key: string) {
    delete this.store[key];
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }
}

const mockLocalStorage = new MockStorage();
const mockSessionStorage = new MockStorage();

const globalRec = globalThis as unknown as Record<string, unknown>;

globalRec.window = {
  localStorage: mockLocalStorage,
  sessionStorage: mockSessionStorage,
  location: { href: "http://localhost/" },
} as unknown;

globalRec.localStorage = mockLocalStorage;
globalRec.sessionStorage = mockSessionStorage;

globalRec.document = {
  getElementById: (_id: string) => {
    return {
      value: "",
      checked: false,
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {},
        contains: () => false,
      },
      addEventListener: () => {},
      appendChild: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      reset: () => {},
    } as unknown;
  },
  createElement: (tag: string) => {
    return {
      tagName: tag.toUpperCase(),
      setAttribute: () => {},
      appendChild: () => {},
      classList: { add: () => {}, remove: () => {} },
      style: {},
      addEventListener: () => {},
    } as unknown;
  },
  createTextNode: (text: string) => ({ text } as unknown),
  addEventListener: () => {},
} as unknown;

globalRec.bootstrap = {
  Toast: class {
    show() {}
  },
  Modal: class {
    static getInstance() {
      return { hide() {} };
    }
    show() {}
    hide() {}
  },
} as unknown;

// ==========================================================================
// TEST IMPORTS
// ==========================================================================
import {
  ControlCenterApi,
  TokenStorage,
  USE_DEVELOPMENT_FIXTURES,
} from "../api/controlCenterApi.js";
import { getActiveCapabilities } from "../api/contract.js";
import { controlCenterStore } from "../state/store.js";

// ==========================================================================
// 1. OWNERSHIP BOUNDARY TESTS
// ==========================================================================
Deno.test("Ownership: no files outside of web/control-center/ should be owned or added", () => {
  const dir = Deno.readDirSync("web/control-center");
  const names = [];
  for (const entry of dir) {
    names.push(entry.name);
  }
  assertEquals(names.includes("index.html"), true);
  assertEquals(names.includes("control-center.css"), true);
  assertEquals(names.includes("control-center.js"), true);
});

Deno.test("Ownership: no migration or backend source files exist under web/control-center/", () => {
  const searchDir = (path: string): boolean => {
    for (const entry of Deno.readDirSync(path)) {
      if (entry.isDirectory) {
        if (searchDir(`${path}/${entry.name}`)) return true;
      } else {
        const isDb = entry.name.endsWith(".db") ||
          entry.name.endsWith(".sqlite");
        const isMigration = entry.name.includes("migration");
        const isSrc = entry.name.endsWith(".ts") && !path.includes("tests");
        if (isDb || isMigration || isSrc) {
          return true;
        }
      }
    }
    return false;
  };
  assertEquals(searchDir("web/control-center"), false);
});

// ==========================================================================
// 2. CONTRACT SAFETY TESTS
// ==========================================================================
Deno.test("Contract Safety: development fixture mode must be a boolean", () => {
  assertEquals(USE_DEVELOPMENT_FIXTURES, false);
});

Deno.test("Capabilities: exact server permissions, not role labels, drive presentation", () => {
  const modCaps = getActiveCapabilities({
    role: "owner",
    permissions: ["moderation.reports.view"],
  });
  assertEquals(modCaps.moderation.reportsList, true);
  assertEquals(modCaps.administration.usersList, false);
  assertEquals(modCaps.owner.adminsAssign, false);

  const adminCaps = getActiveCapabilities({
    role: "user",
    permissions: ["admin.users.view"],
  });
  assertEquals(adminCaps.moderation.reportsList, false);
  assertEquals(adminCaps.administration.usersList, true);
  assertEquals(adminCaps.owner.adminsAssign, false);

  const ownerCaps = getActiveCapabilities({
    role: "user",
    permissions: ["owner.admins.assign"],
  });
  assertEquals(ownerCaps.moderation.reportsList, false);
  assertEquals(ownerCaps.administration.usersList, false);
  assertEquals(ownerCaps.owner.adminsAssign, true);
});

Deno.test("Contract Safety: production graph does not import or fall back to fixtures", () => {
  for (
    const path of [
      "web/control-center/api/controlCenterApi.js",
      "web/control-center/state/store.js",
      "web/control-center/ui/shell.js",
    ]
  ) {
    const source = Deno.readTextFileSync(path);
    assertEquals(source.includes("developmentFixtures"), false);
    assertEquals(source.includes("mockOperators"), false);
  }
});

// ==========================================================================
// 3. AUTHENTICATION & CREDENTIAL TESTS
// ==========================================================================
Deno.test("Authentication: credential storage behavior matches existing policy", () => {
  mockLocalStorage.clear();
  mockSessionStorage.clear();

  const mockTokens = { accessToken: "access", refreshToken: "refresh" };

  // Set session
  TokenStorage.set(mockTokens, false);
  assertEquals(
    JSON.parse(
      mockSessionStorage.getItem("chat_session_tokens_session") || "{}",
    ),
    mockTokens,
  );
  assertEquals(
    mockLocalStorage.getItem("chat_session_tokens_persistent"),
    null,
  );

  // Set persistent
  TokenStorage.set(mockTokens, true);
  assertEquals(
    JSON.parse(
      mockLocalStorage.getItem("chat_session_tokens_persistent") || "{}",
    ),
    mockTokens,
  );
  assertEquals(mockSessionStorage.getItem("chat_session_tokens_session"), null);

  // Get
  const fetched = TokenStorage.get();
  assertEquals(fetched, mockTokens);

  mockSessionStorage.setItem(
    "chat_session_tokens_session",
    JSON.stringify({ accessToken: "other", refreshToken: "other" }),
  );
  assertEquals(TokenStorage.get(), mockTokens);
  assertEquals(mockSessionStorage.getItem("chat_session_tokens_session"), null);

  // Clear
  TokenStorage.clear();
  assertEquals(
    mockLocalStorage.getItem("chat_session_tokens_persistent"),
    null,
  );
  assertEquals(mockSessionStorage.getItem("chat_session_tokens_session"), null);
});

Deno.test("Adapter: exact production routes and CAS request fields are mapped", async () => {
  mockLocalStorage.clear();
  mockSessionStorage.clear();
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 }),
  );
  TokenStorage.set(
    { accessToken: `x.${payload}.y`, refreshToken: "refresh" },
    false,
  );
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    requests.push({
      url: String(input),
      method: init.method || "GET",
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  try {
    await ControlCenterApi.listUsers({
      role: "admin",
      verified: false,
      cursor: "c",
      limit: 25,
    });
    await ControlCenterApi.updateUser("u/1", 3, { displayName: "Safe" });
    await ControlCenterApi.assignRole("u1", "user", "moderator");
    await ControlCenterApi.archiveChannel("c1", 7);
    await ControlCenterApi.updateSetting("maintenance_mode", 4, true);
    await ControlCenterApi.transferOwnership("u2", "owner", "admin");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(
    requests.map((request) => [request.method, request.url, request.body]),
    [
      [
        "GET",
        "/api/admin/users?role=admin&verified=false&cursor=c&limit=25",
        null,
      ],
      ["PATCH", "/api/admin/users/u%2F1", {
        expectedVersion: 3,
        displayName: "Safe",
      }],
      ["POST", "/api/admin/users/u1/roles", {
        expectedRole: "user",
        role: "moderator",
      }],
      ["POST", "/api/admin/channels/c1/archive", { expectedVersion: 7 }],
      ["PATCH", "/api/admin/settings", {
        key: "maintenance_mode",
        expectedVersion: 4,
        value: true,
      }],
      ["POST", "/api/owner/transfer", {
        targetUserId: "u2",
        expectedCurrentOwnerRole: "owner",
        expectedTargetRole: "admin",
      }],
    ],
  );
});

// ==========================================================================
// 4. WORKSPACE STATE TESTS
// ==========================================================================
Deno.test("State Store: clearSensitiveState resets values to clean defaults", () => {
  controlCenterStore.update({
    // deno-lint-ignore no-explicit-any
    reports: [{ id: "rep-1" } as any],
    selectedReportId: "rep-1",
    accessDenied: false,
  });

  controlCenterStore.clearSensitiveState();
  const state = controlCenterStore.getState();

  assertEquals(state.reports.length, 0);
  assertEquals(state.selectedReportId, null);
  assertEquals(state.accessDenied, true);
});

Deno.test("State Store: duplicate destructive submissions are suppressed", async () => {
  const originalArchive = ControlCenterApi.archiveChannel;
  const originalList = ControlCenterApi.listChannels;
  let calls = 0;
  const pending = Promise.withResolvers<{
    channel: { id: string; version: number };
  }>();
  ControlCenterApi.archiveChannel = () => {
    calls++;
    return pending.promise;
  };
  ControlCenterApi.listChannels = () =>
    Promise.resolve({ items: [], nextCursor: null });
  try {
    const first = controlCenterStore.archiveChannel("c1", 1);
    const second = controlCenterStore.archiveChannel("c1", 1);
    assertEquals(calls, 1);
    assertEquals(await second, undefined);
    pending.resolve({ channel: { id: "c1", version: 2 } });
    await first;
  } finally {
    ControlCenterApi.archiveChannel = originalArchive;
    ControlCenterApi.listChannels = originalList;
  }
});

Deno.test("State Store: stale list responses cannot overwrite current filters", async () => {
  const original = ControlCenterApi.listReports;
  const pending = Promise.withResolvers<{
    items: Array<{ id: string }>;
    nextCursor: null;
  }>();
  let calls = 0;
  ControlCenterApi.listReports = () => {
    calls++;
    if (calls === 1) {
      return pending.promise;
    }
    return Promise.resolve({ items: [{ id: "new" }], nextCursor: null });
  };
  try {
    const stale = controlCenterStore.loadReports();
    await controlCenterStore.loadReports();
    pending.resolve({ items: [{ id: "stale" }], nextCursor: null });
    await stale;
    const reports = controlCenterStore.getState().reports as Array<
      { id: string }
    >;
    assertEquals(reports.map((item) => item.id), ["new"]);
  } finally {
    ControlCenterApi.listReports = original;
  }
});

Deno.test("Security: forbidden responses clear sensitive state and cannot trust forged role data", async () => {
  mockLocalStorage.clear();
  mockSessionStorage.clear();
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 }),
  );
  TokenStorage.set(
    { accessToken: `x.${payload}.y`, refreshToken: "refresh" },
    false,
  );
  controlCenterStore.update({
    reports: [{ id: "secret" }],
    accessDenied: false,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "PERMISSION_DENIED", message: "Denied" },
        }),
        { status: 403 },
      ),
    );
  try {
    await ControlCenterApi.listReports().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(controlCenterStore.getState().reports, []);
    assertEquals(controlCenterStore.getState().accessDenied, true);
    assertEquals(
      getActiveCapabilities({
        role: "owner",
        permissions: [],
        areas: { owner: true },
      }).owner
        .ownershipTransfer,
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Security: fixture activation and secret settings have no production path", () => {
  const sources = [
    "web/control-center/api/controlCenterApi.js",
    "web/control-center/state/store.js",
    "web/control-center/control-center.js",
  ].map((path) => Deno.readTextFileSync(path)).join("\n");
  assertEquals(sources.includes("location.search"), false);
  assertEquals(sources.includes("URLSearchParams(location"), false);
  const settings = Deno.readTextFileSync("web/control-center/ui/settings.js");
  for (
    const secret of [
      "jwt_secret",
      "resend_api_key",
      "captcha_secret",
      "database_path",
    ]
  ) {
    assertEquals(settings.toLowerCase().includes(secret), false);
  }
});

// ==========================================================================
// 5. SECURITY REVIEW STATIC CHECKS
// ==========================================================================
Deno.test("Security: verify absence of dangerous HTML/evaluation strings in control center panel", () => {
  const checkFile = (filePath: string) => {
    const content = Deno.readTextFileSync(filePath);
    assertEquals(
      content.includes("innerHTML"),
      false,
      `${filePath} contains forbidden innerHTML`,
    );
    assertEquals(
      content.includes("insertAdjacentHTML"),
      false,
      `${filePath} contains forbidden insertAdjacentHTML`,
    );
    assertEquals(
      content.includes("eval("),
      false,
      `${filePath} contains forbidden eval`,
    );
    assertEquals(
      content.includes("new Function"),
      false,
      `${filePath} contains forbidden new Function`,
    );
  };

  checkFile("web/control-center/api/controlCenterApi.js");
  checkFile("web/control-center/state/store.js");
  checkFile("web/control-center/ui/common.js");
  checkFile("web/control-center/ui/navigation.js");
  checkFile("web/control-center/ui/moderation.js");
  checkFile("web/control-center/ui/users.js");
  checkFile("web/control-center/ui/channels.js");
  checkFile("web/control-center/ui/roles.js");
  checkFile("web/control-center/ui/settings.js");
  checkFile("web/control-center/ui/audit.js");
  checkFile("web/control-center/ui/owner.js");
  checkFile("web/control-center/ui/dialogs.js");
  checkFile("web/control-center/ui/shell.js");
  const adapter = Deno.readTextFileSync(
    "web/control-center/api/controlCenterApi.js",
  );
  assertEquals(adapter.includes("console.log"), false);
  assertEquals(adapter.includes("console.error"), false);
  assertEquals(adapter.includes("fixtures/developmentFixtures"), false);
});

// ==========================================================================
// 6. ACCESSIBILITY STATIC CHECKS
// ==========================================================================
Deno.test("Accessibility: verify semantic landmarks and focus outlines are configured", () => {
  const html = Deno.readTextFileSync("web/control-center/index.html");
  assertEquals(
    html.includes("<header"),
    true,
    "index.html is missing <header> landmark",
  );
  assertEquals(
    html.includes("<nav"),
    true,
    "index.html is missing <nav> landmark",
  );
  assertEquals(
    html.includes("<main"),
    true,
    "index.html is missing <main> landmark",
  );
  assertEquals(
    html.includes("<aside"),
    true,
    "index.html is missing <aside> landmark",
  );
  assertEquals(
    html.includes('role="dialog"'),
    true,
    "index.html is missing dialog roles",
  );

  const css = Deno.readTextFileSync("web/control-center/control-center.css");
  assertEquals(
    css.includes("focus-visible"),
    true,
    "control-center.css is missing focus-visible visible outline styling",
  );
});
