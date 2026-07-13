import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { UserService } from "../../src/domain/users/userService.ts";
import { NotFoundError } from "../../src/shared/errors/notFoundError.ts";
import { FakeUserRepository } from "../support/fakeUserRepository.ts";

function makeService() {
  const users = new FakeUserRepository();
  users.create({
    id: "u-1",
    username: "alice",
    displayName: "Alice",
    email: "alice@example.com",
    passwordHash: "hash",
  });
  return new UserService(users);
}

Deno.test("UserService.getProfile returns the profile shape for an existing user", () => {
  const service = makeService();
  const profile = service.getProfile("u-1");
  assertEquals(profile.username, "alice");
  assertEquals(profile.bio, "");
  assertEquals(profile.messagesSent, 0);
});

Deno.test("UserService.getProfile throws NotFoundError for a missing user", () => {
  const service = makeService();
  assertThrows(() => service.getProfile("ghost"), NotFoundError);
});

Deno.test("UserService.updateProfile applies a partial patch", () => {
  const service = makeService();
  const updated = service.updateProfile("u-1", { displayName: "Alice Two", bio: "hi" });
  assertEquals(updated.displayName, "Alice Two");
  assertEquals(updated.bio, "hi");
});
