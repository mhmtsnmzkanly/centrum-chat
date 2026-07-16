import { assertEquals } from "jsr:@std/assert@1";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { RouteRegistry } from "../../src/application/http/routeRegistry.ts";
import {
  GetAuthPreferencesRoute,
  UpdateAuthLocaleRoute,
} from "../../src/application/http/routes/auth/preferencesRoutes.ts";
import { startHttpServer } from "../../src/transport/http/httpServer.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { PreferencesService } from "../../src/domain/preferences/preferencesService.ts";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";

async function bootLocalePreferencesServer() {
  const database = await createTestDb();
  new SqliteUserRepository(database.db).create({
    id: "locale-user",
    username: "locale_user",
    displayName: "Locale User",
    email: "locale@example.com",
    passwordHash: "hash",
  });
  const codec = new JsonCodec();
  const tokenService = new TokenService({
    secret: "locale-preferences-secret",
    accessTokenTtlSeconds: 900,
  });
  const preferences = new PreferencesService(new SqlitePreferencesRepository(database.db));
  const registry = new RouteRegistry();
  registry.register(new GetAuthPreferencesRoute(preferences, tokenService, codec));
  registry.register(new UpdateAuthLocaleRoute(preferences, tokenService, codec));
  const server = startHttpServer({
    host: "127.0.0.1",
    port: 0,
    registry,
    codec,
    logger: createLogger("error", "test-locale-preferences"),
  });
  const accessToken = await tokenService.signAccessToken(
    "locale-user",
    "locale_user",
    "locale-session",
  );
  return {
    baseUrl: `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`,
    accessToken,
    cleanup: async () => {
      await server.shutdown();
      await database.cleanup();
    },
  };
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("auth preferences HTTP routes persist an explicit locale idempotently", async () => {
  const harness = await bootLocalePreferencesServer();
  try {
    const headers = { authorization: `Bearer ${harness.accessToken}` };
    const initialResponse = await fetch(`${harness.baseUrl}/api/auth/preferences`, { headers });
    assertEquals(initialResponse.status, 200);
    const initial = await readBody(initialResponse) as {
      data: { preferences: { locale: string | null } };
    };
    assertEquals(initial.data.preferences.locale, null);

    for (const locale of ["tr", "tr", "en"]) {
      const updateResponse = await fetch(`${harness.baseUrl}/api/auth/preferences`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      assertEquals(updateResponse.status, 200);
      const updated = await readBody(updateResponse) as {
        data: { preferences: { locale: string } };
      };
      assertEquals(updated.data.preferences.locale, locale);
    }

    const restoredResponse = await fetch(`${harness.baseUrl}/api/auth/preferences`, { headers });
    const restored = await readBody(restoredResponse) as {
      data: { preferences: { locale: string } };
    };
    assertEquals(restored.data.preferences.locale, "en");
  } finally {
    await harness.cleanup();
  }
});

Deno.test("auth preferences HTTP routes reject unsupported locale and missing authentication", async () => {
  const harness = await bootLocalePreferencesServer();
  try {
    const invalidResponse = await fetch(`${harness.baseUrl}/api/auth/preferences`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${harness.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ locale: "fr" }),
    });
    assertEquals(invalidResponse.status, 400);
    const invalid = await readBody(invalidResponse) as { error: { code: string } };
    assertEquals(invalid.error.code, "VALIDATION_ERROR");

    const unauthenticatedResponse = await fetch(`${harness.baseUrl}/api/auth/preferences`);
    assertEquals(unauthenticatedResponse.status, 401);
    const unauthenticated = await readBody(unauthenticatedResponse) as {
      error: { code: string };
    };
    assertEquals(unauthenticated.error.code, "UNAUTHORIZED");
  } finally {
    await harness.cleanup();
  }
});
