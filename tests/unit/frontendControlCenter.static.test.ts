import { assert } from "jsr:@std/assert@1";

// Static source checks pinning the Control Center's lime-csr structure:
// partial-composed templates instead of one monolithic template, the
// options-object mount signature, config-driven sidebar, and store computeds
// backing every reactive path the templates reference.

const html = await Deno.readTextFile(new URL("../../web/control-center.html", import.meta.url));
const entryJs = await Deno.readTextFile(
  new URL("../../web/scripts/control-center.js", import.meta.url),
);
const storeJs = await Deno.readTextFile(
  new URL("../../web/scripts/control-center-store.js", import.meta.url),
);

Deno.test("control center root template composes sections through partials", () => {
  const partials = [
    "cc-access-denied",
    "cc-sidebar",
    "cc-topbar",
    "cc-panel-reports",
    "cc-panel-moderation-audit",
    "cc-panel-users",
    "cc-panel-channels",
    "cc-panel-roles",
    "cc-panel-settings",
    "cc-panel-security-audit",
    "cc-panel-ownership",
    "cc-modal-apply-sanction",
    "cc-modal-confirm",
  ];
  for (const name of partials) {
    assert(html.includes(`<partial name="${name}"`), `missing partial usage: ${name}`);
    assert(html.includes(`<template id="tpl-${name}">`), `missing template: tpl-${name}`);
  }
});

Deno.test("both audit panels share one row partial fed per reactive loop item", () => {
  assert(html.includes('<partial name="cc-audit-row" data="ev"></partial>'));
  assert((html.match(/<partial name="cc-audit-row"/g) || []).length === 2);
  assert(html.includes('<template id="tpl-cc-audit-row">'));
  // The row prints the store-computed target display, not a "${a || b}"
  // pseudo-expression (lime interpolation is path-only).
  assert(html.includes("${targetDisplay}"));
  assert(!html.includes("|| 'N/A'"));
});

Deno.test("sidebar navigation is rendered from the static navGroups config", () => {
  assert(entryJs.includes("const NAV_GROUPS = ["));
  assert(entryJs.includes("context: { navGroups: NAV_GROUPS }"));
  assert(html.includes('<for each="groups" as="group">'));
  assert(html.includes('data-show="showTab_${item.tab}"'));
  assert(html.includes('data-nav="navClass_${item.tab}"'));
});

Deno.test("mount uses the options-object signature", () => {
  assert(entryJs.includes('mount("control-center", {'));
  assert(entryJs.includes("target: appRoot,"));
  assert(entryJs.includes("store: controlCenterStore,"));
});

Deno.test("store defines every shell/report computed the templates bind", () => {
  const computedPaths = [
    "showShell",
    "workspaceTitleText",
    "operatorAvatarText",
    "operatorRoleUpper",
    "operatorBadgeClass",
    "reportsListCountLabel",
    "reportsListEmpty",
    "selectedReportFormattedDate",
    "selectedReportStatusClass",
    "showAssignButton",
    "canApplySanctions",
    "canRevokeSanctions",
    "moderationAuditEmpty",
    "securityAuditEmpty",
  ];
  for (const path of computedPaths) {
    assert(storeJs.includes(`"${path}"`), `missing computed: ${path}`);
  }
});

Deno.test("editable user fields bind two-way to a per-selection draft", () => {
  assert(html.includes('data-model="userEditDraft.displayName"'));
  assert(html.includes('data-model="userEditDraft.bio"'));
  assert(html.includes('data-model="userEditDraft.disabled"'));
  assert(storeJs.includes("userEditDraft: {"));
  // The broken bare "{checked}" attribute pattern must not come back.
  assert(!html.includes("{checked}"));
  assert(!html.includes('value="{display}"'));
});

Deno.test("both entry points disable Lime CSR development mode before mount", async () => {
  const chatJs = await Deno.readTextFile(new URL("../../web/scripts/chat.js", import.meta.url));
  const ccJs = await Deno.readTextFile(
    new URL("../../web/scripts/control-center.js", import.meta.url),
  );

  assert(chatJs.includes("setDevMode(false);"), "chat.js must disable dev mode");
  assert(ccJs.includes("setDevMode(false);"), "control-center.js must disable dev mode");

  // Make sure it runs before mount
  const chatMountIdx = chatJs.indexOf("mount(");
  const chatSetDevIdx = chatJs.indexOf("setDevMode(false);");
  assert(
    chatSetDevIdx !== -1 && (chatMountIdx === -1 || chatSetDevIdx < chatMountIdx),
    "chat.js setDevMode must execute before mount",
  );

  const ccMountIdx = ccJs.indexOf("mount(");
  const ccSetDevIdx = ccJs.indexOf("setDevMode(false);");
  assert(
    ccSetDevIdx !== -1 && (ccMountIdx === -1 || ccSetDevIdx < ccMountIdx),
    "control-center.js setDevMode must execute before mount",
  );
});
