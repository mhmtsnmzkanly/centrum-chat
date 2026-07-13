import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { SearchService } from "../../src/domain/search/searchService.ts";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { FakeMessageRepository } from "../support/fakeMessageRepositories.ts";
import {
  FakeConversationMemberRepository,
  FakeConversationRepository,
} from "../support/fakeConversationRepositories.ts";
import { FakeReactionRepository } from "../support/fakeReactionRepository.ts";
import { FakeAttachmentRepository } from "../support/fakeAttachmentRepository.ts";
import { FakeUserRepository } from "../support/fakeUserRepository.ts";
import { FakeTransactionManager } from "../support/fakeTransactionManager.ts";
import { ForbiddenError } from "../../src/shared/errors/forbiddenError.ts";
import { NotFoundError } from "../../src/shared/errors/notFoundError.ts";

function makeServices() {
  const memberRepo = new FakeConversationMemberRepository();
  const roomRepo = new FakeConversationRepository(memberRepo);
  const messages = new FakeMessageRepository();
  const permissions = new PermissionService(memberRepo);
  const messageService = new MessageService(
    messages,
    roomRepo,
    permissions,
    new RateLimiter({ maxTokens: 1000, refillIntervalMs: 10_000 }),
    new FakeTransactionManager(),
    new FakeReactionRepository(),
    new FakeAttachmentRepository(),
  );
  const users = new FakeUserRepository();
  const service = new SearchService(messages, messageService, roomRepo, permissions, users);
  return { service, roomRepo, memberRepo, messages, users };
}

Deno.test("SearchService.searchMessages: substring match, newest first, excludes soft-deleted", () => {
  const { service, roomRepo, messages } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  messages.create({
    id: "m-1",
    conversationId: channel.id,
    authorId: "u-1",
    content: "the quick brown fox",
    replyToId: null,
    isSystem: false,
  });
  messages.create({
    id: "m-2",
    conversationId: channel.id,
    authorId: "u-1",
    content: "nothing relevant here",
    replyToId: null,
    isSystem: false,
  });
  const toDelete = messages.create({
    id: "m-3",
    conversationId: channel.id,
    authorId: "u-1",
    content: "the quick deleted fox",
    replyToId: null,
    isSystem: false,
  });
  messages.softDelete(toDelete.id);

  const results = service.searchMessages("u-1", channel.id, "quick");
  assertEquals(results.map((m) => m.id), ["m-1"]);
});

Deno.test("SearchService.searchMessages denies a non-member of a group", () => {
  const { service, roomRepo } = makeServices();
  const group = roomRepo.create({ id: "g-1", type: "group", isPublic: false });
  assertThrows(() => service.searchMessages("stranger", group.id, "hi"), ForbiddenError);
});

Deno.test("SearchService.searchMessages throws NotFoundError for an unknown room", () => {
  const { service } = makeServices();
  assertThrows(() => service.searchMessages("u-1", "no-such-room", "hi"), NotFoundError);
});

Deno.test("SearchService.searchUsers matches username or display name substrings", () => {
  const { service, users } = makeServices();
  users.create({
    id: "u-1",
    username: "bob_builder",
    displayName: "Bob the Builder",
    email: "bob@example.com",
    passwordHash: "hash",
  });
  users.create({
    id: "u-2",
    username: "alice",
    displayName: "Alice Wonderland",
    email: "alice@example.com",
    passwordHash: "hash",
  });

  assertEquals(service.searchUsers("bob").map((u) => u.id), ["u-1"]);
  assertEquals(service.searchUsers("Wonderland").map((u) => u.id), ["u-2"]);
  assertEquals(service.searchUsers("nonexistent"), []);
});
