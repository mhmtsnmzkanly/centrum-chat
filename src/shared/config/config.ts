import { parseAllowedOrigins } from "../security/originPolicy.ts";
import { createTrustedProxyMatcher } from "../security/clientIp.ts";

export interface Config {
  readonly appEnv: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly mediaRoot: string;
  readonly publicBaseUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly jwtSecret: string;
  readonly accessTokenTtlSeconds: number;
  readonly sessionDefaultTtlMs: number;
  readonly sessionRememberedTtlMs: number;
  readonly emailVerificationTtlMs: number;
  readonly passwordResetTtlMs: number;
  readonly emailChangeTtlMs: number;
  readonly mailAdapter: "development" | "resend";
  readonly mailFromAddress: string;
  readonly mailFromName: string;
  readonly resendApiKey: string | null;
  readonly captchaAdapter: "development" | "turnstile" | "none";
  readonly captchaSiteKey: string;
  readonly captchaSecretKey: string | null;
  readonly captchaExpectedHostname: string;
  readonly bootstrapOwnerEmail: string | null;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly maxAttachmentSizeBytes: number;
  readonly maxAvatarSizeBytes: number;
  readonly maxCoverSizeBytes: number;
  readonly maxWsMessageBytes: number;
  readonly wsProtocolErrorLimit: number;
  readonly wsInboundRateLimitMaxTokens: number;
  readonly wsInboundRateLimitRefillIntervalMs: number;
  readonly wsMaxConnectionsPerUser: number;
  readonly wsMaxConnectionsPerIp: number;
  readonly wsMaxBufferedAmountBytes: number;
  readonly wsHeartbeatIntervalMs: number;
  readonly wsIdleTimeoutMs: number;
  readonly publicHttps: boolean;
  readonly sessionCleanupIntervalMs: number;
  readonly revokedSessionRetentionMs: number;
  /** Socket peers allowed to speak for clients via X-Forwarded-For (IPs or CIDR blocks). */
  readonly trustedProxyIps: readonly string[];
}

function requireEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return Deno.env.get(key) ?? fallback;
}

function optionalIntEnv(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (!raw) return fallback;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${raw}`);
  }
  const parsed = Number.parseInt(raw, 10);
  return parsed;
}

function optionalPositiveIntEnv(key: string, fallback: number): number {
  const parsed = optionalIntEnv(key, fallback);
  if (parsed <= 0) {
    throw new Error(`Environment variable ${key} must be greater than zero, got: ${parsed}`);
  }
  return parsed;
}

function optionalNonNegativeIntEnv(key: string, fallback: number): number {
  const parsed = optionalIntEnv(key, fallback);
  if (parsed < 0) {
    throw new Error(`Environment variable ${key} must be zero or greater, got: ${parsed}`);
  }
  return parsed;
}

function optionalBooleanEnv(key: string, fallback: boolean): boolean {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Environment variable ${key} must be "true" or "false", got: ${raw}`);
}

function assertIntRange(key: string, value: number, min: number, max: number): void {
  if (value < min || value > max) {
    throw new Error(`Environment variable ${key} must be between ${min} and ${max}, got: ${value}`);
  }
}

function parseLogLevel(raw: string): Config["logLevel"] {
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  throw new Error(`LOG_LEVEL must be one of debug|info|warn|error, got: ${raw}`);
}

function parseMailAdapter(raw: string): Config["mailAdapter"] {
  if (raw === "development" || raw === "resend") return raw;
  throw new Error(`MAIL_ADAPTER must be one of development|resend, got: ${raw}`);
}

function parseCaptchaAdapter(raw: string): Config["captchaAdapter"] {
  if (raw === "development" || raw === "turnstile" || raw === "none") return raw;
  throw new Error("CAPTCHA_ADAPTER must be one of development|turnstile|none, got: " + raw);
}

function parseAppEnv(raw: string): Config["appEnv"] {
  if (raw === "development" || raw === "test" || raw === "production") return raw;
  throw new Error(`APP_ENV must be one of development|test|production, got: ${raw}`);
}

function parseTrustedProxyIps(raw: string): readonly string[] {
  const entries = raw.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  try {
    // Built once here purely as validation: a typo must fail the boot, not silently
    // disable (or widen) forwarded-header trust at runtime.
    createTrustedProxyMatcher(entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`TRUSTED_PROXY_IPS is invalid: ${message}`);
  }
  return entries;
}

function validateProductionConfig(config: Config): void {
  assertIntRange("PORT", config.port, 1, 65_535);
  assertIntRange("ACCESS_TOKEN_TTL_SECONDS", config.accessTokenTtlSeconds, 60, 86_400);
  assertIntRange("SESSION_DEFAULT_TTL_MS", config.sessionDefaultTtlMs, 900_000, 2_592_000_000);
  assertIntRange(
    "SESSION_REMEMBERED_TTL_MS",
    config.sessionRememberedTtlMs,
    config.sessionDefaultTtlMs,
    7_776_000_000,
  );
  assertIntRange(
    "EMAIL_VERIFICATION_TTL_MS",
    config.emailVerificationTtlMs,
    300_000,
    604_800_000,
  );
  assertIntRange("PASSWORD_RESET_TTL_MS", config.passwordResetTtlMs, 300_000, 86_400_000);
  assertIntRange("EMAIL_CHANGE_TTL_MS", config.emailChangeTtlMs, 300_000, 604_800_000);
  assertIntRange("MAX_WS_MESSAGE_BYTES", config.maxWsMessageBytes, 1_024, 1_048_576);
  assertIntRange("WS_PROTOCOL_ERROR_LIMIT", config.wsProtocolErrorLimit, 1, 20);
  assertIntRange(
    "WS_INBOUND_RATE_LIMIT_MAX_TOKENS",
    config.wsInboundRateLimitMaxTokens,
    1,
    10_000,
  );
  assertIntRange(
    "WS_INBOUND_RATE_LIMIT_REFILL_INTERVAL_MS",
    config.wsInboundRateLimitRefillIntervalMs,
    100,
    3_600_000,
  );
  assertIntRange("WS_MAX_CONNECTIONS_PER_USER", config.wsMaxConnectionsPerUser, 1, 100);
  assertIntRange("WS_MAX_CONNECTIONS_PER_IP", config.wsMaxConnectionsPerIp, 1, 500);
  if (config.wsMaxConnectionsPerIp < config.wsMaxConnectionsPerUser) {
    throw new Error(
      "WS_MAX_CONNECTIONS_PER_IP must be greater than or equal to WS_MAX_CONNECTIONS_PER_USER.",
    );
  }
  assertIntRange(
    "WS_MAX_BUFFERED_AMOUNT_BYTES",
    config.wsMaxBufferedAmountBytes,
    65_536,
    8_388_608,
  );
  assertIntRange("WS_HEARTBEAT_INTERVAL_MS", config.wsHeartbeatIntervalMs, 5_000, 300_000);
  assertIntRange("WS_IDLE_TIMEOUT_MS", config.wsIdleTimeoutMs, 15_000, 900_000);
  if (config.wsIdleTimeoutMs <= config.wsHeartbeatIntervalMs) {
    throw new Error("WS_IDLE_TIMEOUT_MS must be greater than WS_HEARTBEAT_INTERVAL_MS.");
  }
  if (config.sessionRememberedTtlMs < config.sessionDefaultTtlMs) {
    throw new Error(
      "SESSION_REMEMBERED_TTL_MS must be greater than or equal to SESSION_DEFAULT_TTL_MS.",
    );
  }
  if (config.mailAdapter === "resend" && !config.resendApiKey) {
    throw new Error("RESEND_API_KEY is required when MAIL_ADAPTER=resend.");
  }
  if (
    config.captchaAdapter === "turnstile" &&
    (!config.captchaSecretKey || !config.captchaSiteKey || !config.captchaExpectedHostname)
  ) {
    throw new Error(
      "CAPTCHA_SITE_KEY, CAPTCHA_SECRET_KEY, and CAPTCHA_EXPECTED_HOSTNAME are required for Turnstile.",
    );
  }

  const publicBaseUrl = new URL(config.publicBaseUrl);
  if (config.appEnv === "production" && publicBaseUrl.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must use https in production.");
  }

  if (config.appEnv !== "production") return;
  if (Deno.env.get("PUBLIC_BASE_URL") === undefined) {
    throw new Error("PUBLIC_BASE_URL must be set explicitly in production.");
  }
  if (
    config.jwtSecret.length < 32 || config.jwtSecret.includes("change-me") ||
    config.jwtSecret.includes("test-secret")
  ) {
    throw new Error(
      "JWT_SECRET must be a strong non-placeholder secret of at least 32 characters in production.",
    );
  }
  if (config.allowedOrigins.some((origin) => origin === "*")) {
    throw new Error("ALLOWED_ORIGINS must not contain '*' in production.");
  }
  if (config.mailAdapter === "development") {
    throw new Error("MAIL_ADAPTER=development is not allowed in production.");
  }
  if (config.captchaAdapter === "development") {
    throw new Error("CAPTCHA_ADAPTER=development is not allowed in production.");
  }
}

/** Loads and validates configuration once at boot. Fails fast on missing/invalid values. */
export function loadConfig(): Config {
  const config: Config = {
    appEnv: parseAppEnv(optionalEnv("APP_ENV", "development")),
    host: optionalEnv("HOST", "0.0.0.0"),
    port: optionalIntEnv("PORT", 8080),
    databasePath: optionalEnv("DATABASE_PATH", "./storage/database/centrumchat.sqlite"),
    mediaRoot: optionalEnv("MEDIA_ROOT", "./storage"),
    publicBaseUrl: optionalEnv("PUBLIC_BASE_URL", "http://localhost:8080"),
    allowedOrigins: parseAllowedOrigins(optionalEnv("ALLOWED_ORIGINS", "")),
    jwtSecret: requireEnv("JWT_SECRET"),
    accessTokenTtlSeconds: optionalIntEnv("ACCESS_TOKEN_TTL_SECONDS", 900),
    sessionDefaultTtlMs: optionalPositiveIntEnv("SESSION_DEFAULT_TTL_MS", 86_400_000),
    sessionRememberedTtlMs: optionalPositiveIntEnv("SESSION_REMEMBERED_TTL_MS", 2_592_000_000),
    emailVerificationTtlMs: optionalPositiveIntEnv("EMAIL_VERIFICATION_TTL_MS", 3_600_000),
    passwordResetTtlMs: optionalPositiveIntEnv("PASSWORD_RESET_TTL_MS", 1_800_000),
    emailChangeTtlMs: optionalPositiveIntEnv("EMAIL_CHANGE_TTL_MS", 3_600_000),
    mailAdapter: parseMailAdapter(optionalEnv("MAIL_ADAPTER", "development")),
    mailFromAddress: optionalEnv("MAIL_FROM_ADDRESS", "noreply@example.invalid"),
    mailFromName: optionalEnv("MAIL_FROM_NAME", "CentrumChat"),
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? null,
    captchaAdapter: parseCaptchaAdapter(optionalEnv("CAPTCHA_ADAPTER", "development")),
    captchaSiteKey: optionalEnv("CAPTCHA_SITE_KEY", ""),
    captchaSecretKey: Deno.env.get("CAPTCHA_SECRET_KEY") ?? null,
    captchaExpectedHostname: optionalEnv("CAPTCHA_EXPECTED_HOSTNAME", "localhost"),
    bootstrapOwnerEmail: Deno.env.get("BOOTSTRAP_OWNER_EMAIL") ?? null,
    logLevel: parseLogLevel(optionalEnv("LOG_LEVEL", "info")),
    maxAttachmentSizeBytes: optionalIntEnv("MAX_ATTACHMENT_SIZE_BYTES", 26214400),
    maxAvatarSizeBytes: optionalIntEnv("MAX_AVATAR_SIZE_BYTES", 5242880),
    maxCoverSizeBytes: optionalIntEnv("MAX_COVER_SIZE_BYTES", 5242880),
    maxWsMessageBytes: optionalPositiveIntEnv("MAX_WS_MESSAGE_BYTES", 65_536),
    wsProtocolErrorLimit: optionalPositiveIntEnv("WS_PROTOCOL_ERROR_LIMIT", 3),
    wsInboundRateLimitMaxTokens: optionalPositiveIntEnv("WS_INBOUND_RATE_LIMIT_MAX_TOKENS", 120),
    wsInboundRateLimitRefillIntervalMs: optionalPositiveIntEnv(
      "WS_INBOUND_RATE_LIMIT_REFILL_INTERVAL_MS",
      10_000,
    ),
    wsMaxConnectionsPerUser: optionalPositiveIntEnv("WS_MAX_CONNECTIONS_PER_USER", 5),
    wsMaxConnectionsPerIp: optionalPositiveIntEnv("WS_MAX_CONNECTIONS_PER_IP", 25),
    wsMaxBufferedAmountBytes: optionalPositiveIntEnv("WS_MAX_BUFFERED_AMOUNT_BYTES", 1_048_576),
    wsHeartbeatIntervalMs: optionalPositiveIntEnv("WS_HEARTBEAT_INTERVAL_MS", 30_000),
    wsIdleTimeoutMs: optionalPositiveIntEnv("WS_IDLE_TIMEOUT_MS", 90_000),
    publicHttps: optionalBooleanEnv("PUBLIC_HTTPS", false),
    sessionCleanupIntervalMs: optionalPositiveIntEnv("SESSION_CLEANUP_INTERVAL_MS", 21_600_000),
    revokedSessionRetentionMs: optionalNonNegativeIntEnv(
      "REVOKED_SESSION_RETENTION_MS",
      2_592_000_000,
    ),
    trustedProxyIps: parseTrustedProxyIps(optionalEnv("TRUSTED_PROXY_IPS", "")),
  };
  validateProductionConfig(config);
  return config;
}
