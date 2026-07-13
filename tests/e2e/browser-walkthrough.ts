// End-to-end browser walkthrough for the CentrumChat web UI (not part of `deno task test`).
//
// Usage:
//   1. Start a throwaway server, e.g.:
//      HOST=127.0.0.1 PORT=8123 DATABASE_PATH=/tmp/e2e.sqlite MEDIA_ROOT=/tmp/e2e-media \
//      JWT_SECRET=e2e-test-secret ... deno run --allow-net --allow-env --allow-read --allow-write src/main.ts
//   2. deno run -A tests/e2e/browser-walkthrough.ts
//
// Requires a chromium binary at /usr/bin/chromium (adjust executablePath below).
// Exercises: register/login, channel messaging + live push, replies, typing indicator,
// message edit, reactions, premium badge + name color, bio edit, avatar regenerate,
// avatar/cover upload, DM open via user search, DM notifications, group create/members/
// owner badge, mutual-groups chip, message search, image attachment + lightbox,
// password change + re-login, session restore, presence status change.
import puppeteer from "npm:puppeteer-core@23.11.1";

const BASE = "http://127.0.0.1:8123";
const RUN = Math.random().toString(36).slice(2, 7);
const results: string[] = [];
const consoleIssues: string[] = [];
let failures = 0;

function ok(label: string) {
  results.push(`PASS ${label}`);
  console.log(`PASS ${label}`);
}
function fail(label: string, err?: unknown) {
  failures++;
  results.push(`FAIL ${label}: ${err}`);
  console.log(`FAIL ${label}: ${err}`);
}

async function step(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok(label);
  } catch (err) {
    fail(label, err instanceof Error ? err.message : err);
    await diag();
  }
}

// deno-lint-ignore no-explicit-any
let diagPages: Array<[string, any]> = [];
async function diag() {
  for (const [name, page] of diagPages) {
    try {
      const d = await page.evaluate(() => ({
        modals: [...document.querySelectorAll(".modal.show")].map((m) => m.id),
        backdrops: document.querySelectorAll(".modal-backdrop").length,
        dest: document.querySelector(".destination-value")?.textContent?.trim(),
        // deno-lint-ignore no-explicit-any
        msgQuery: (globalThis as any).__centrum?.store?.get("searchState.messageQuery"),
        // deno-lint-ignore no-explicit-any
        activeDest: (globalThis as any).__centrum?.store?.get("activeDest"),
      }));
      console.log(`  diag ${name}: ${JSON.stringify(d)}`);
    } catch { /* page gone */ }
  }
}

// deno-lint-ignore no-explicit-any
async function resetOverlays(page: any) {
  await page.evaluate(() => {
    for (const m of document.querySelectorAll(".modal.show")) {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).bootstrap.Modal.getOrCreateInstance(m).hide();
    }
  });
  await page.waitForFunction(
    () => !document.querySelector(".modal.show") && !document.querySelector(".modal-backdrop"),
    { timeout: 3000 },
  ).catch(() => {});
}

function settle(ms = 800) {
  return new Promise((r) => setTimeout(r, ms));
}

// deno-lint-ignore no-explicit-any
type Page = any;

function watchPage(page: Page, name: string) {
  page.on("console", (msg: { type: () => string; text: () => string }) => {
    const text = msg.text();
    if (msg.type() === "error" || msg.type() === "warn" || text.includes("[lime-csr]")) {
      if (text.includes("preload") || text.includes("net::ERR_") || text.includes("favicon")) {
        return;
      }
      consoleIssues.push(`[${name}][${msg.type()}] ${text}`);
    }
  });
  page.on("pageerror", (err: Error) => {
    consoleIssues.push(`[${name}][pageerror] ${err.message}`);
  });
  page.on("response", (r: { status: () => number; url: () => string }) => {
    if (r.status() >= 400) {
      consoleIssues.push(`[${name}][http ${r.status()}] ${r.url()}`);
    }
  });
}

async function registerUser(page: Page, username: string, password = "secret123") {
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForSelector("#app .auth-card", { timeout: 15000 });
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll(".auth-card .nav-link")];
    const signup = tabs.find((t) => t.textContent!.includes("Sign Up")) as HTMLElement;
    signup.click();
  });
  await page.waitForSelector("#signupUsername", { timeout: 5000 });
  await page.type("#signupUsername", username);
  await page.type("#signupEmail", `${username}@example.com`);
  await page.type("#signupPassword", password);
  await page.evaluate(() => {
    const form = document.querySelector("#signupPassword")!.closest("form")!;
    (form.querySelector("button[type=submit]") as HTMLElement).click();
  });
  await page.waitForSelector(".chat-header", { timeout: 15000 });
}

async function noBackdrop(page: Page) {
  await page.waitForFunction(
    () => !document.querySelector(".modal-backdrop"),
    { timeout: 5000 },
  );
}

async function sendChannelMessage(page: Page, text: string) {
  await noBackdrop(page);
  await page.evaluate(() => (document.getElementById("messageInput") as HTMLElement).focus());
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (t: string) =>
      [...document.querySelectorAll(".message-bubble")].some((b) => b.textContent!.includes(t)),
    { timeout: 8000 },
    text,
  );
}

// Minimal raw client for scripted side-actors.
class RawClient {
  ws!: WebSocket;
  seq = 0;
  // deno-lint-ignore no-explicit-any
  pending = new Map<string, (v: any) => void>();
  accessToken = "";
  // deno-lint-ignore no-explicit-any
  user: any = null;

  async register(username: string, password = "secret123") {
    const resp = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        email: `${username}@example.com`,
        password,
        displayName: username,
      }),
    });
    const json = await resp.json();
    if (!json.success) throw new Error("raw register failed: " + JSON.stringify(json));
    this.accessToken = json.data.accessToken;
    this.user = json.data.user;
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(
        `${BASE.replace("http", "ws")}/ws?token=${encodeURIComponent(this.accessToken)}`,
      );
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (ev) => {
        const env = JSON.parse(ev.data as string);
        if (env.id && this.pending.has(env.id)) {
          const res = this.pending.get(env.id)!;
          this.pending.delete(env.id);
          res(env);
        }
      };
    });
  }

  // deno-lint-ignore no-explicit-any
  request(event: string, data: unknown): Promise<any> {
    const id = `raw-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(
        id,
        (env) => env.success ? resolve(env.data) : reject(new Error(env.error?.message)),
      );
      this.ws.send(JSON.stringify({ id, event, data }));
    });
  }
}

// 1x1 red PNG
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const pngPath = new URL("./tiny.png", import.meta.url).pathname;
await Deno.writeFile(pngPath, PNG_BYTES);

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const ctxA = await browser.createBrowserContext();
const ctxB = await browser.createBrowserContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();
watchPage(pageA, "alice");
watchPage(pageB, "bob");
diagPages = [["alice", pageA], ["bob", pageB]];
await pageA.setViewport({ width: 1440, height: 900 });
await pageB.setViewport({ width: 1440, height: 900 });

const ALICE = `alice_${RUN}`;
const BOB = `bob_${RUN}`;
const CHARLIE = `charlie_${RUN}`;

let aliceMsg1Id = "";

await step("register alice -> chat visible", async () => {
  await registerUser(pageA, ALICE);
});

await step("alice sends a channel message", async () => {
  await sendChannelMessage(pageA, `Hello from ${ALICE}`);
  aliceMsg1Id = await pageA.evaluate(() => {
    const groups = [...document.querySelectorAll(".message-group")];
    return groups[groups.length - 1].id.replace("group_", "");
  });
  if (!aliceMsg1Id) throw new Error("no message id");
});

await step("register bob -> sees alice's message from history", async () => {
  await registerUser(pageB, BOB);
  await pageB.waitForFunction(
    (t: string) =>
      [...document.querySelectorAll(".message-bubble")].some((b) => b.textContent!.includes(t)),
    { timeout: 8000 },
    `Hello from ${ALICE}`,
  );
});

await step("bob receives alice's live push message", async () => {
  await sendChannelMessage(pageA, `Live push ${RUN}`);
  await pageB.waitForFunction(
    (t: string) =>
      [...document.querySelectorAll(".message-bubble")].some((b) => b.textContent!.includes(t)),
    { timeout: 8000 },
    `Live push ${RUN}`,
  );
  const author = await pageB.evaluate((t: string) => {
    const bubble = [...document.querySelectorAll(".message-bubble")].find((b) =>
      b.textContent!.includes(t)
    )!;
    return bubble.closest(".message-group")!.querySelector(".username")!.textContent;
  }, `Live push ${RUN}`);
  if (!author || !author.includes(ALICE)) throw new Error(`author is "${author}"`);
});

await step("bob replies to alice's message (reply preview renders)", async () => {
  await pageB.evaluate((id: string) => {
    const group = document.getElementById(`group_${id}`)!;
    (group.querySelector('[data-on-click="startReply"]') as HTMLElement).click();
  }, aliceMsg1Id);
  await pageB.waitForFunction(
    () => document.querySelector("#replyContextBar")!.classList.contains("show"),
    { timeout: 5000 },
  );
  await pageB.evaluate(() => (document.getElementById("messageInput") as HTMLElement).focus());
  await pageB.keyboard.type(`Reply from ${BOB}`);
  await pageB.keyboard.press("Enter");
  await pageA.waitForFunction(
    (t: string) =>
      [...document.querySelectorAll(".reply-preview-bubble")].length > 0 &&
      [...document.querySelectorAll(".message-bubble")].some((b) => b.textContent!.includes(t)),
    { timeout: 8000 },
    `Reply from ${BOB}`,
  );
  const replySender = await pageA.evaluate(() => {
    const el = [...document.querySelectorAll(".reply-preview-bubble .reply-sender")].pop();
    return el ? el.textContent : "";
  });
  if (!replySender || !replySender.includes(ALICE)) {
    throw new Error(`reply sender "${replySender}"`);
  }
});

await step("alice sees bob's typing indicator", async () => {
  await pageB.evaluate(() => (document.getElementById("messageInput") as HTMLElement).focus());
  await pageB.keyboard.type("typing...");
  await pageA.waitForFunction(
    (name: string) => {
      const bar = document.getElementById("typingIndicator");
      return bar && bar.classList.contains("show") && bar.textContent!.includes(name);
    },
    { timeout: 8000 },
    BOB,
  );
  await pageB.evaluate(() => {
    const input = document.getElementById("messageInput") as HTMLTextAreaElement;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
});

await step("alice edits her message -> (edited) tag on bob's screen", async () => {
  await pageA.evaluate((id: string) => {
    const group = document.getElementById(`group_${id}`)!;
    (group.querySelector('[data-on-click="startEditMsg"]') as HTMLElement).click();
  }, aliceMsg1Id);
  await pageA.evaluate(() => {
    const input = document.getElementById("messageInput") as HTMLTextAreaElement;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
  await pageA.keyboard.type(`Edited hello ${RUN}`);
  await pageA.keyboard.press("Enter");
  await pageB.waitForFunction(
    (id: string) => {
      const group = document.getElementById(`group_${id}`);
      return group && group.textContent!.includes("Edited hello") &&
        group.querySelector(".edited-tag");
    },
    { timeout: 8000 },
    aliceMsg1Id,
  );
});

const rawReactor = new RawClient();
await step("scripted user reacts -> badge appears for alice", async () => {
  await rawReactor.register(`react_${RUN}`);
  await rawReactor.request("reaction.toggle", { messageId: aliceMsg1Id, emoji: "👍" });
  await pageA.waitForFunction(
    (id: string) => {
      const group = document.getElementById(`group_${id}`);
      return group && group.querySelector(".reaction-badge");
    },
    { timeout: 8000 },
    aliceMsg1Id,
  );
});

await step("alice toggles same reaction -> count 2 + user-reacted", async () => {
  await pageA.evaluate((id: string) => {
    const group = document.getElementById(`group_${id}`)!;
    (group.querySelector(".reaction-badge") as HTMLElement).click();
  }, aliceMsg1Id);
  await pageA.waitForFunction(
    (id: string) => {
      const group = document.getElementById(`group_${id}`);
      const badge = group?.querySelector(".reaction-badge");
      return badge && badge.classList.contains("user-reacted") &&
        badge.textContent!.includes("2");
    },
    { timeout: 8000 },
    aliceMsg1Id,
  );
});

await step("alice sets premium + name color via preferences", async () => {
  await pageA.evaluate(() => document.getElementById("profileDropdownBtn")!.click());
  await pageA.waitForFunction(
    () => document.querySelector(".profile-nav-dropdown-menu.show") !== null,
    { timeout: 5000 },
  );
  await pageA.evaluate(() => {
    const btn = [...document.querySelectorAll(".profile-card-actions button")].find((b) =>
      b.textContent!.includes("Preferences")
    ) as HTMLElement;
    btn.click();
  });
  await pageA.waitForSelector("#preferencesModal.show", { timeout: 5000 });
  await pageA.evaluate(() => {
    const toggle = document.getElementById("prefPremiumToggle") as HTMLInputElement;
    if (!toggle.checked) toggle.click();
    const color = document.querySelector(
      '#preferencesModal input[type="color"]',
    ) as HTMLInputElement;
    color.value = "#7c3aed";
    color.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await pageA.evaluate(() => {
    const btn = [...document.querySelectorAll("#preferencesModal button")].find((b) =>
      b.textContent!.includes("Save Changes")
    ) as HTMLElement;
    btn.click();
  });
  await pageA.waitForFunction(
    () => !document.querySelector("#preferencesModal.show"),
    { timeout: 8000 },
  );
  await sendChannelMessage(pageA, `Premium check ${RUN}`);
  await pageB.waitForFunction(
    (t: string) => {
      const bubble = [...document.querySelectorAll(".message-bubble")].find((b) =>
        b.textContent!.includes(t)
      );
      if (!bubble) return false;
      const group = bubble.closest(".message-group")!;
      return group.querySelector(".premium-badge") !== null;
    },
    { timeout: 8000 },
    `Premium check ${RUN}`,
  );
});

await step("alice edits bio inline", async () => {
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="startBioEdit"]') as HTMLElement).click();
  });
  await pageA.waitForSelector(".bio-editor-container textarea", { timeout: 5000 });
  await pageA.evaluate(() => {
    const ta = document.querySelector(".bio-editor-container textarea") as HTMLTextAreaElement;
    ta.value = "E2E bio text";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="saveBioEdit"]') as HTMLElement).click();
  });
  await pageA.waitForFunction(
    () => {
      const bio = document.querySelector(".profile-card-bio");
      return bio && bio.textContent === "E2E bio text";
    },
    { timeout: 5000 },
  );
});

await step("alice regenerates avatar seed", async () => {
  const before = await pageA.evaluate(() =>
    // deno-lint-ignore no-explicit-any
    ((globalThis as any).__centrum.store.get("session.user") as { avatarSeed: string }).avatarSeed
  );
  await pageA.evaluate(() => {
    const btn = [...document.querySelectorAll(".profile-card-actions button")].find((b) =>
      b.textContent!.includes("Regenerate Avatar")
    ) as HTMLElement;
    btn.click();
  });
  await pageA.waitForFunction(
    (prev: string) => {
      // deno-lint-ignore no-explicit-any
      const u = (globalThis as any).__centrum.store.get("session.user") as { avatarSeed: string };
      return u.avatarSeed !== prev && u.avatarSeed.length > 0;
    },
    { timeout: 8000 },
    before,
  );
});

await step("alice uploads avatar + cover", async () => {
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="openProfileImagesModal"]') as HTMLElement).click();
  });
  await pageA.waitForSelector("#profileImagesModal.show", { timeout: 5000 });
  const avatarInput = await pageA.$("#avatarFileInput");
  await avatarInput.uploadFile(pngPath);
  const coverInput = await pageA.$("#coverFileInput");
  await coverInput.uploadFile(pngPath);
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="saveProfileGraphics"]') as HTMLElement).click();
  });
  await pageA.waitForFunction(
    () => {
      const btn = document.getElementById("profileDropdownBtn")!;
      return btn.style.background.includes("/media/");
    },
    { timeout: 8000 },
  );
  await pageA.waitForFunction(
    () => {
      const header = document.querySelector(".profile-card-header") as HTMLElement;
      return header && header.style.background.includes("/media/");
    },
    { timeout: 8000 },
  );
});

await step("bob opens DM with alice via Users tab search", async () => {
  await pageB.evaluate(() => document.getElementById("channelDropdownSelector")!.click());
  await pageB.waitForFunction(
    () => document.querySelector(".destination-dropdown-menu.show") !== null,
    { timeout: 5000 },
  );
  await pageB.evaluate(() => {
    const btns = [...document.querySelectorAll("#destTabs .nav-link")];
    (btns.find((b) => b.textContent!.includes("Users")) as HTMLElement).click();
  });
  await pageB.waitForSelector('.destination-dropdown-menu input[placeholder="Search users..."]', {
    timeout: 5000,
  });
  await pageB.evaluate((q: string) => {
    const input = document.querySelector(
      '.destination-dropdown-menu input[placeholder="Search users..."]',
    ) as HTMLInputElement;
    input.focus();
    input.value = q;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, ALICE.slice(0, 6));
  await pageB.waitForFunction(
    (name: string) => {
      const items = [...document.querySelectorAll('[data-on-click="selectDm"]')];
      return items.some((i) => i.textContent!.includes(name));
    },
    { timeout: 8000 },
    ALICE,
  );
  await pageB.evaluate((name: string) => {
    const items = [...document.querySelectorAll('[data-on-click="selectDm"]')];
    (items.find((i) => i.textContent!.includes(name)) as HTMLElement).click();
  }, ALICE);
  await pageB.waitForFunction(
    () => document.querySelector(".destination-value")!.textContent!.includes("@"),
    { timeout: 8000 },
  );
  await sendChannelMessage(pageB, `DM hello ${RUN}`);
});

await step("alice gets DM notification badge and reads the DM", async () => {
  await pageA.waitForFunction(
    () => {
      const badge = document.getElementById("headerNotificationBadge")!;
      return !badge.classList.contains("d-none") && badge.textContent !== "0";
    },
    { timeout: 8000 },
  );
  await pageA.evaluate(() => document.getElementById("channelDropdownSelector")!.click());
  await pageA.waitForFunction(
    () => document.querySelector(".destination-dropdown-menu.show") !== null,
    { timeout: 5000 },
  );
  await pageA.evaluate(() => {
    const btns = [...document.querySelectorAll("#destTabs .nav-link")];
    (btns.find((b) => b.textContent!.includes("Users")) as HTMLElement).click();
  });
  await pageA.waitForFunction(
    (name: string) => {
      const items = [...document.querySelectorAll('[data-on-click="selectDm"]')];
      return items.some((i) => i.textContent!.includes(name));
    },
    { timeout: 8000 },
    BOB,
  );
  await pageA.evaluate((name: string) => {
    const items = [...document.querySelectorAll('[data-on-click="selectDm"]')];
    (items.find((i) => i.textContent!.includes(name)) as HTMLElement).click();
  }, BOB);
  await pageA.waitForFunction(
    (t: string) =>
      [...document.querySelectorAll(".message-bubble")].some((b) => b.textContent!.includes(t)),
    { timeout: 8000 },
    `DM hello ${RUN}`,
  );
});

const charlie = new RawClient();
await step("charlie (scripted) DMs alice -> appears in alice's users list", async () => {
  await charlie.register(CHARLIE);
  const aliceId = await pageA.evaluate(() =>
    // deno-lint-ignore no-explicit-any
    ((globalThis as any).__centrum.store.get("session.user") as { id: string }).id
  );
  const dmRes = await charlie.request("dm.open", { userId: aliceId });
  await charlie.request("message.send", {
    conversationId: dmRes.room.id,
    content: `Charlie says hi ${RUN}`,
  });
  await pageA.waitForFunction(
    (name: string) => {
      const items = [...document.querySelectorAll('[data-on-click="selectDm"]')];
      return items.some((i) => i.textContent!.includes(name));
    },
    { timeout: 10000 },
    CHARLIE,
  );
});

await step("alice creates a group with bob + charlie", async () => {
  await pageA.evaluate(() => {
    const btns = [...document.querySelectorAll("#destTabs .nav-link")];
    (btns.find((b) => b.textContent!.includes("Groups")) as HTMLElement).click();
  });
  await pageA.waitForFunction(
    () => document.querySelector('[data-on-click="openCreateGroup"]') !== null,
    { timeout: 5000 },
  );
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="openCreateGroup"]') as HTMLElement).click();
  });
  await pageA.waitForSelector("#createGroupModal.show", { timeout: 5000 });
  await pageA.type("#newGroupNameInput", `E2E Group ${RUN}`);
  const candidateCount = await pageA.evaluate(() => {
    const checks = [
      ...document.querySelectorAll('#createGroupModal input[type="checkbox"]'),
    ] as HTMLInputElement[];
    checks.forEach((c) => c.click());
    return checks.length;
  });
  if (candidateCount < 2) throw new Error(`only ${candidateCount} candidates`);
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="submitCreateGroup"]') as HTMLElement).click();
  });
  await pageA.waitForFunction(
    (name: string) => document.querySelector(".destination-value")!.textContent!.includes(name),
    { timeout: 10000 },
    `E2E Group ${RUN}`,
  );
  await pageA.waitForFunction(
    () => document.querySelector(".system-message-badge") !== null,
    { timeout: 8000 },
  );
});

await step("group members modal lists 3 members with owner badge", async () => {
  await resetOverlays(pageA);
  await settle();
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="openGroupMembers"]') as HTMLElement).click();
  });
  try {
    await pageA.waitForSelector("#groupMembersModal.show", { timeout: 5000 });
    await pageA.waitForFunction(
      () => document.querySelectorAll("#groupMembersModal .group-member-row").length === 3,
      { timeout: 8000 },
    );
  } catch (err) {
    const dump = await pageA.evaluate(() => {
      // deno-lint-ignore no-explicit-any
      const st = (globalThis as any).__centrum.store;
      const el = document.getElementById("groupMembersModal");
      return {
        modalClass: el?.className,
        modalCount: document.querySelectorAll("#groupMembersModal").length,
        rows: document.querySelectorAll("#groupMembersModal .group-member-row").length,
        rowsAnywhere: document.querySelectorAll(".group-member-row").length,
        members: (st.get("groupMembersForm.members") || []).length,
        badgeBtn: !!document.querySelector('[data-on-click="openGroupMembers"]'),
      };
    });
    console.log("  MEMBERS DUMP:", JSON.stringify(dump));
    throw err;
  }
  const hasOwner = await pageA.evaluate(() =>
    [...document.querySelectorAll("#groupMembersModal .group-member-row")].some((r) =>
      r.textContent!.includes("Owner")
    )
  );
  if (!hasOwner) throw new Error("no Owner badge");
  const kickBtns = await pageA.evaluate(() =>
    document.querySelectorAll("#groupMembersModal .kick-member-btn").length
  );
  if (kickBtns !== 2) throw new Error(`expected 2 kick buttons, got ${kickBtns}`);
  await pageA.evaluate(() => {
    (document.querySelector("#groupMembersModal .btn-close") as HTMLElement).click();
  });
  await pageA.waitForFunction(
    () => !document.querySelector("#groupMembersModal.show"),
    { timeout: 5000 },
  );
});

await step("visitor profile shows mutual group chip", async () => {
  await resetOverlays(pageA);
  await settle();
  await noBackdrop(pageA);
  await pageA.evaluate(() => {
    const btns = [...document.querySelectorAll("#destTabs .nav-link")];
    (btns.find((b) => b.textContent!.includes("Channels")) as HTMLElement).click();
  });
  await pageA.waitForFunction(
    () => document.querySelectorAll('[data-on-click="selectChannel"]').length > 0,
    { timeout: 5000 },
  );
  await pageA.evaluate(() => {
    const items = [...document.querySelectorAll('[data-on-click="selectChannel"]')];
    (items.find((i) => i.textContent!.includes("general")) as HTMLElement).click();
  });
  await pageA.waitForFunction(
    (name: string) => {
      const users = [...document.querySelectorAll(".message-meta .username")];
      return users.some((u) => u.textContent!.includes(name));
    },
    { timeout: 8000 },
    BOB,
  );
  await pageA.evaluate((name: string) => {
    const users = [...document.querySelectorAll(".message-meta .username")];
    (users.find((u) => u.textContent!.includes(name)) as HTMLElement).click();
  }, BOB);
  await pageA.waitForSelector("#visitorProfileModal.show", { timeout: 8000 });
  try {
    await pageA.waitForFunction(
      (groupName: string) => {
        const chips = [...document.querySelectorAll(".visitor-group-chip")];
        return chips.some((c) => c.textContent!.includes(groupName));
      },
      { timeout: 8000 },
      `E2E Group ${RUN}`,
    );
  } catch (err) {
    const dump = await pageA.evaluate(() => {
      // deno-lint-ignore no-explicit-any
      const st = (globalThis as any).__centrum.store;
      const vp = st.get("visitorProfile");
      return {
        vpUser: vp.username,
        vpMutual: vp.mutualGroups,
        vpHas: vp.hasMutualGroups,
        chips: [...document.querySelectorAll(".visitor-group-chip")].map((c) => c.textContent),
      };
    });
    console.log("  VISITOR DUMP:", JSON.stringify(dump));
    throw err;
  }
  await pageA.evaluate(() => {
    (document.querySelector("#visitorProfileModal .btn-close") as HTMLElement).click();
  });
  await pageA.waitForFunction(
    () => !document.querySelector("#visitorProfileModal.show"),
    { timeout: 5000 },
  );
});

await step("message search returns results", async () => {
  await resetOverlays(pageA);
  await noBackdrop(pageA);
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="toggleSearch"]') as HTMLElement).click();
  });
  await pageA.waitForFunction(
    () => document.getElementById("searchBarContainer")!.classList.contains("show"),
    { timeout: 5000 },
  );
  await pageA.evaluate(() => {
    const input = document.getElementById("messageSearchInput") as HTMLInputElement;
    input.focus();
    input.value = "Premium check";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await pageA.waitForFunction(
    () => {
      const bubbles = [...document.querySelectorAll(".message-bubble")];
      return bubbles.length >= 1 && bubbles.every((b) => b.textContent!.includes("Premium check"));
    },
    { timeout: 8000 },
  );
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="clearMessageSearch"]') as HTMLElement).click();
  });
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="toggleSearch"]') as HTMLElement).click();
  });
});

await step("image attachment renders (no 401) and lightbox opens", async () => {
  await resetOverlays(pageA);
  const attachInput = await pageA.$("#fileAttachInput");
  await attachInput.uploadFile(pngPath);
  await pageA.evaluate(() => (document.getElementById("messageInput") as HTMLElement).focus());
  await pageA.keyboard.type(`Image attach ${RUN}`);
  await pageA.keyboard.press("Enter");
  await pageA.waitForFunction(
    () => {
      const img = document.querySelector(".image-preview-container img") as HTMLImageElement;
      return img && img.complete && img.naturalWidth > 0;
    },
    { timeout: 10000 },
  );
  await pageA.evaluate(() => {
    (document.querySelector(".image-preview-container img") as HTMLElement).click();
  });
  await pageA.waitForFunction(
    () => {
      const lb = document.getElementById("imageLightbox")!;
      const img = document.getElementById("lightboxImg") as HTMLImageElement;
      return lb.classList.contains("show") && img.src.includes("/media/");
    },
    { timeout: 5000 },
  );
  await pageA.evaluate(() => {
    (document.querySelector(".lightbox-close") as HTMLElement).click();
  });
  await pageA.waitForFunction(
    () => !document.getElementById("imageLightbox")!.classList.contains("show"),
    { timeout: 5000 },
  );
});

await step("password change -> re-login with new password", async () => {
  await resetOverlays(pageA);
  await settle();
  await pageA.evaluate(() => {
    const btn = [...document.querySelectorAll(".profile-card-actions button")].find((b) =>
      b.textContent!.includes("Preferences")
    ) as HTMLElement;
    btn.click();
  });
  await pageA.waitForSelector("#preferencesModal.show", { timeout: 5000 });
  await pageA.evaluate(() => {
    const tabs = [...document.querySelectorAll("#preferencesModal .nav-link")];
    (tabs.find((t) => t.textContent!.includes("Security")) as HTMLElement).click();
  });
  await pageA.waitForSelector("#prefCurrentPassword", { timeout: 5000 });
  await pageA.evaluate(() => {
    const setVal = (id: string, v: string) => {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setVal("prefCurrentPassword", "secret123");
    setVal("prefNewPassword", "newsecret456");
    setVal("prefConfirmPassword", "newsecret456");
  });
  const pwForm = await pageA.evaluate(() => {
    // deno-lint-ignore no-explicit-any
    const st = (globalThis as any).__centrum.store;
    return {
      cur: st.get("preferencesForm.currentPassword"),
      nw: st.get("preferencesForm.newPassword"),
      cf: st.get("preferencesForm.confirmPassword"),
    };
  });
  console.log("  PW FORM:", JSON.stringify(pwForm));
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="updatePassword"]') as HTMLElement).click();
  });
  try {
    await pageA.waitForFunction(
      () =>
        [...document.querySelectorAll(".toast")].some((t) =>
          t.textContent!.includes("Password updated")
        ),
      { timeout: 8000 },
    );
  } catch (err) {
    const toasts = await pageA.evaluate(() =>
      [...document.querySelectorAll(".toast")].map((t) => t.textContent!.trim().slice(0, 70))
    );
    console.log("  PW TOASTS:", JSON.stringify(toasts));
    throw err;
  }
  await pageA.evaluate(() => {
    (document.querySelector("#preferencesModal .btn-close") as HTMLElement).click();
  });
  await pageA.waitForFunction(() => !document.querySelector("#preferencesModal.show"), {
    timeout: 5000,
  });
  await noBackdrop(pageA);
  await pageA.evaluate(() => {
    (document.querySelector('[data-on-click="handleLogout"]') as HTMLElement).click();
  });
  await pageA.waitForSelector("#app .auth-card", { timeout: 8000 });
  await pageA.waitForSelector("#signinEmail", { timeout: 5000 });
  await pageA.type("#signinEmail", `${ALICE}@example.com`);
  await pageA.type("#signinPassword", "newsecret456");
  await pageA.evaluate(() => {
    const form = document.querySelector("#signinPassword")!.closest("form")!;
    (form.querySelector("button[type=submit]") as HTMLElement).click();
  });
  await pageA.waitForSelector(".chat-header", { timeout: 10000 });
});

await step("session restore on reload", async () => {
  await pageA.reload({ waitUntil: "networkidle2" });
  await pageA.waitForSelector(".chat-header", { timeout: 10000 });
});

await step("status change via dropdown select", async () => {
  await pageA.evaluate(() => document.getElementById("profileDropdownBtn")!.click());
  await pageA.waitForFunction(
    () => document.querySelector(".profile-nav-dropdown-menu.show") !== null,
    { timeout: 5000 },
  );
  await pageA.evaluate(() => {
    const sel = document.querySelector(".profile-nav-dropdown-menu select") as HTMLSelectElement;
    sel.value = "idle";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await pageA.waitForFunction(
    () =>
      [...document.querySelectorAll(".toast")].some((t) =>
        t.textContent!.includes("Status updated")
      ),
    { timeout: 8000 },
  );
});

console.log("\n──── console issues ────");
if (consoleIssues.length === 0) console.log("(none)");
for (const issue of consoleIssues) console.log(issue);

console.log("\n──── summary ────");
console.log(results.join("\n"));
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);

await browser.close();
Deno.exit(failures === 0 ? 0 : 1);
