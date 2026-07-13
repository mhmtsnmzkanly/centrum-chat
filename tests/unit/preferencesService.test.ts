import { assertEquals } from "jsr:@std/assert@1";
import { PreferencesService } from "../../src/domain/preferences/preferencesService.ts";
import {
  DEFAULT_PREFERENCES,
  FakePreferencesRepository,
} from "../support/fakePreferencesRepository.ts";

Deno.test("PreferencesService.get returns schema defaults for a first-time user", () => {
  const service = new PreferencesService(new FakePreferencesRepository());
  assertEquals(service.get("u-1"), DEFAULT_PREFERENCES);
});

Deno.test("PreferencesService.update applies only the given fields", () => {
  const service = new PreferencesService(new FakePreferencesRepository());
  const updated = service.update("u-1", { theme: "light", sound: false });
  assertEquals(updated.theme, "light");
  assertEquals(updated.sound, false);
  assertEquals(updated.dmPrivacy, "everyone");
});
