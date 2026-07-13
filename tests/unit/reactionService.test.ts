import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ReactionService } from "../../src/domain/reactions/reactionService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { FakeMessageRepository } from "../support/fakeMessageRepositories.ts";
import {
  FakeConversationMemberRepository,
  FakeConversationRepository,
} from "../support/fakeConversationRepositories.ts";
import { FakeReactionRepository } from "../support/fakeReactionRepository.ts";
import { ForbiddenError } from "../../src/shared/errors/forbiddenError.ts";
import { NotFoundError } from "../../src/shared/errors/notFoundError.ts";

function makeServices() {
  const memberRepo = new FakeConversationMemberRepository();
  const roomRepo = new FakeConversationRepository(memberRepo);
  const messages = new FakeMessageRepository();
  const reactions = new FakeReactionRepository();
  const permissions = new PermissionService(memberRepo);
  const service = new ReactionService(reactions, messages, roomRepo, permissions);
  return { service, roomRepo, memberRepo, messages, reactions };
}

Deno.test("ReactionService.toggle adds a reaction on first call, removes on second (toggle semantics)", () => {
  const { service, roomRepo, messages } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = messages.create({
    id: "m-1",
    conversationId: channel.id,
    authorId: "author",
    content: "hi",
    replyToId: null,
    isSystem: false,
  });

  const added = service.toggle("u-1", message.id, "👍");
  assertEquals(added.reactions, [{ emoji: "👍", userIds: ["u-1"] }]);
  assertEquals(added.added, true);

  const removed = service.toggle("u-1", message.id, "👍");
  assertEquals(removed.reactions, []);
  assertEquals(removed.added, false);
});

Deno.test("ReactionService.toggle returns the message's authorId, for the notification layer to use", () => {
  const { service, roomRepo, messages } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = messages.create({
    id: "m-1",
    conversationId: channel.id,
    authorId: "the-author",
    content: "hi",
    replyToId: null,
    isSystem: false,
  });

  const result = service.toggle("u-1", message.id, "👍");
  assertEquals(result.messageAuthorId, "the-author");
});

Deno.test("ReactionService.toggle aggregates multiple users per emoji and keeps emojis separate", () => {
  const { service, roomRepo, messages } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = messages.create({
    id: "m-1",
    conversationId: channel.id,
    authorId: "author",
    content: "hi",
    replyToId: null,
    isSystem: false,
  });

  service.toggle("u-1", message.id, "👍");
  service.toggle("u-2", message.id, "👍");
  const result = service.toggle("u-1", message.id, "🎉");

  const byEmoji = Object.fromEntries(result.reactions.map((r) => [r.emoji, r.userIds.sort()]));
  assertEquals(byEmoji, { "👍": ["u-1", "u-2"], "🎉": ["u-1"] });
});

Deno.test("ReactionService.toggle denies a non-member of a group", () => {
  const { service, roomRepo, messages } = makeServices();
  const group = roomRepo.create({ id: "g-1", type: "group", isPublic: false });
  const message = messages.create({
    id: "m-1",
    conversationId: group.id,
    authorId: "author",
    content: "hi",
    replyToId: null,
    isSystem: false,
  });

  assertThrows(() => service.toggle("stranger", message.id, "👍"), ForbiddenError);
});

Deno.test("ReactionService.toggle throws NotFoundError for a missing message", () => {
  const { service } = makeServices();
  assertThrows(() => service.toggle("u-1", "no-such-message", "👍"), NotFoundError);
});

Deno.test("ReactionService.toggle returns the conversationId for the fan-out layer to use", () => {
  const { service, roomRepo, messages } = makeServices();
  const channel = roomRepo.create({ id: "c-1", type: "channel", isPublic: true });
  const message = messages.create({
    id: "m-1",
    conversationId: channel.id,
    authorId: "author",
    content: "hi",
    replyToId: null,
    isSystem: false,
  });

  const result = service.toggle("u-1", message.id, "👍");
  assertEquals(result.conversationId, channel.id);
});
