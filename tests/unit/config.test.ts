import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { loadConfig } from "../../src/shared/config/config.ts";

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("loadConfig rejects nonsensical session cleanup configuration", () => {
  withEnv(
    {
      JWT_SECRET: "test-secret",
      SESSION_CLEANUP_INTERVAL_MS: "0",
      REVOKED_SESSION_RETENTION_MS: "1000",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );

  withEnv(
    {
      JWT_SECRET: "test-secret",
      SESSION_CLEANUP_INTERVAL_MS: "1000",
      REVOKED_SESSION_RETENTION_MS: "-1",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );
});

Deno.test("loadConfig rejects malformed origin and websocket abuse settings", () => {
  withEnv(
    {
      JWT_SECRET: "test-secret",
      ALLOWED_ORIGINS: "not-a-valid-origin",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );

  withEnv(
    {
      JWT_SECRET: "test-secret",
      MAX_WS_MESSAGE_BYTES: "0",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );

  withEnv(
    {
      JWT_SECRET: "test-secret",
      PUBLIC_HTTPS: "yes",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );

  withEnv(
    {
      JWT_SECRET: "test-secret",
      WS_IDLE_TIMEOUT_MS: "30000",
      WS_HEARTBEAT_INTERVAL_MS: "30000",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );

  withEnv(
    {
      JWT_SECRET: "test-secret",
      WS_MAX_CONNECTIONS_PER_USER: "6",
      WS_MAX_CONNECTIONS_PER_IP: "5",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );
});

Deno.test("loadConfig rejects placeholder production JWT secrets", () => {
  withEnv(
    {
      APP_ENV: "production",
      JWT_SECRET: "change-me-to-a-random-64-char-hex-string",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );
});

Deno.test("loadConfig rejects invalid session, public URL, and mail adapter production settings", () => {
  withEnv(
    {
      JWT_SECRET: "test-secret",
      SESSION_DEFAULT_TTL_MS: "86400000",
      SESSION_REMEMBERED_TTL_MS: "86399999",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );

  withEnv(
    {
      APP_ENV: "production",
      JWT_SECRET: "this-is-a-strong-production-jwt-secret-value-123456",
      PUBLIC_BASE_URL: "http://chat.example.com",
      MAIL_ADAPTER: "resend",
      RESEND_API_KEY: "test-key",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );

  withEnv(
    {
      APP_ENV: "production",
      JWT_SECRET: "this-is-a-strong-production-jwt-secret-value-123456",
      PUBLIC_BASE_URL: "https://chat.example.com",
      MAIL_ADAPTER: "development",
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );

  withEnv(
    {
      JWT_SECRET: "test-secret",
      MAIL_ADAPTER: "resend",
      RESEND_API_KEY: undefined,
    },
    () => {
      assertThrows(() => loadConfig(), Error);
    },
  );
});

Deno.test("loadConfig rejects CAPTCHA bypass and incomplete Turnstile settings in production", () => {
  const productionBase = {
    APP_ENV: "production",
    JWT_SECRET: "this-is-a-strong-production-jwt-secret-value-123456",
    PUBLIC_BASE_URL: "https://chat.example.com",
    MAIL_ADAPTER: "resend",
    RESEND_API_KEY: "resend-key",
    ALLOWED_ORIGINS: "https://chat.example.com",
  };
  withEnv(
    {
      ...productionBase,
      CAPTCHA_ADAPTER: "development",
    },
    () => assertThrows(() => loadConfig(), Error),
  );
  withEnv(
    {
      ...productionBase,
      CAPTCHA_ADAPTER: "turnstile",
      CAPTCHA_SITE_KEY: "",
      CAPTCHA_SECRET_KEY: undefined,
      CAPTCHA_EXPECTED_HOSTNAME: "chat.example.com",
    },
    () => assertThrows(() => loadConfig(), Error),
  );
  withEnv(
    {
      ...productionBase,
      CAPTCHA_ADAPTER: "none",
    },
    () => {
      const config = loadConfig();
      assertEquals(config.captchaAdapter, "none");
    },
  );
});
