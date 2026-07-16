import { MESSAGE_CATALOGS, SOURCE_TRANSLATIONS_TR } from "./i18n-catalogs.js";

export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = Object.freeze(["en", "tr"]);
export const LOCALE_STORAGE_KEY = "centrumchat_locale";

const listeners = new Set();
const reverseTurkish = new Map(
  Object.entries(SOURCE_TRANSLATIONS_TR).map(([source, translated]) => [translated, source]),
);
const sourceByNormalized = new Map(
  Object.keys(SOURCE_TRANSLATIONS_TR).map((source) => [source.toLocaleLowerCase("en"), source]),
);
const reverseByNormalized = new Map(
  Object.entries(SOURCE_TRANSLATIONS_TR).map(([source, translated]) => [
    translated.toLocaleLowerCase("tr"),
    source,
  ]),
);

function normalizeLocale(value) {
  const locale = String(value || "").toLowerCase().split("-")[0];
  return SUPPORTED_LOCALES.includes(locale) ? locale : null;
}

function storedLocale() {
  try {
    return normalizeLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

let activeLocale = storedLocale() ||
  normalizeLocale(globalThis.navigator?.language) || DEFAULT_LOCALE;

export function getLocale() {
  return activeLocale;
}

export function hasStoredLocale() {
  return storedLocale() !== null;
}

export function t(key, values = {}) {
  const template = MESSAGE_CATALOGS[activeLocale]?.[key] ??
    MESSAGE_CATALOGS[activeLocale]?.[`auth.${key}`] ??
    MESSAGE_CATALOGS[DEFAULT_LOCALE]?.[key] ??
    MESSAGE_CATALOGS[DEFAULT_LOCALE]?.[`auth.${key}`] ?? key;
  return Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function tp(key, count, values = {}) {
  const category = new Intl.PluralRules(activeLocale).select(count);
  const categoryKey = `${key}.${category}`;
  const fallbackKey = `${key}.other`;
  return t(t(categoryKey) === categoryKey ? fallbackKey : categoryKey, { count, ...values });
}

export function localizeError(errorOrCode, fallback = t("error.INTERNAL_ERROR")) {
  const code = typeof errorOrCode === "string"
    ? errorOrCode
    : errorOrCode?.serverCode || errorOrCode?.code;
  if (!code) return fallback;
  const key = `error.${code}`;
  const localized = t(key);
  return localized === key ? fallback : localized;
}

export function formatDate(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return t("common.notAvailable");
  return new Intl.DateTimeFormat(activeLocale, options).format(date);
}

export function formatDateTime(value, options = {}) {
  return formatDate(value, { dateStyle: "medium", timeStyle: "short", ...options });
}

export function formatRelativeTime(value, now = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return t("common.notAvailable");
  const seconds = Math.round((date.getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(activeLocale, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function sourceKey(value) {
  return reverseTurkish.get(value) ||
    reverseByNormalized.get(value.toLocaleLowerCase("tr")) ||
    sourceByNormalized.get(value.toLocaleLowerCase("en")) || value;
}

export function translateSourceText(value) {
  const prefix = value.match(/^([^\p{L}\p{N}]*)/u)?.[0] || "";
  const core = value.slice(prefix.length);
  const source = sourceKey(core);
  const translated = activeLocale === "tr" ? (SOURCE_TRANSLATIONS_TR[source] || source) : source;
  return `${prefix}${translated}`;
}

function translateTextNode(node) {
  const value = node.nodeValue;
  const trimmed = value?.trim();
  if (!trimmed) return;
  const translated = translateSourceText(trimmed);
  if (translated === trimmed) return;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  node.nodeValue = `${leading}${translated}${trailing}`;
}

function translateTree(root) {
  if (!root) return;
  const elements = [
    ...(root.matches?.("[data-i18n]") ? [root] : []),
    ...(root.querySelectorAll?.("[data-i18n]") || []),
  ];
  for (const element of elements) {
    const translated = t(element.dataset.i18n);
    if (element.textContent !== translated) element.textContent = translated;
  }
  const attributeBindings = {
    "data-i18n-placeholder": "placeholder",
    "data-i18n-title": "title",
    "data-i18n-aria-label": "aria-label",
    "data-i18n-content": "content",
  };
  for (const [binding, attribute] of Object.entries(attributeBindings)) {
    const boundElements = [
      ...(root.matches?.(`[${binding}]`) ? [root] : []),
      ...(root.querySelectorAll?.(`[${binding}]`) || []),
    ];
    for (const element of boundElements) {
      element.setAttribute(attribute, t(element.getAttribute(binding)));
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest("script, style, [data-i18n], [data-text], [data-lime-ignore]")
    ) continue;
    translateTextNode(node);
  }
  for (const attribute of ["placeholder", "title", "aria-label"]) {
    for (const element of root.querySelectorAll?.(`[${attribute}]`) || []) {
      if (element.hasAttribute(`data-i18n-${attribute}`)) continue;
      const current = element.getAttribute(attribute);
      const translated = current ? translateSourceText(current) : current;
      if (translated && translated !== current) element.setAttribute(attribute, translated);
    }
  }
}

export function translateDocument(root = globalThis.document) {
  if (!root) return;
  translateTree(root);
  if (root === globalThis.document) {
    for (const template of globalThis.document.querySelectorAll("template")) {
      translateTree(template.content);
    }
  }
  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.lang = activeLocale;
  }
}

export function observeTranslations(root = globalThis.document?.body) {
  if (!root || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          if (
            parent &&
            !parent.closest("script, style, [data-i18n], [data-text], [data-lime-ignore]")
          ) translateTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          translateTree(node);
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function setLocale(locale, { persist = true } = {}) {
  const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
  if (persist) {
    try {
      globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch {
      // A blocked storage API must not prevent an in-memory language change.
    }
  }
  if (normalized === activeLocale) {
    translateDocument();
    return activeLocale;
  }
  activeLocale = normalized;
  translateDocument();
  for (const listener of listeners) listener(activeLocale);
  return activeLocale;
}

export function subscribeLocale(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bindLocaleSelect(select, onPersist) {
  if (!select) return () => {};
  select.value = activeLocale;
  const sync = (locale) => {
    if (select.value !== locale) select.value = locale;
  };
  const unsubscribe = subscribeLocale(sync);
  const change = async () => {
    const locale = setLocale(select.value);
    if (onPersist) await onPersist(locale);
  };
  select.addEventListener("change", change);
  return () => {
    unsubscribe();
    select.removeEventListener("change", change);
  };
}
