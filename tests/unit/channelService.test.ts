import { assertEquals } from "jsr:@std/assert@1";
import { ChannelService } from "../../src/domain/conversations/channelService.ts";
import {
  FakeConversationMemberRepository,
  FakeConversationRepository,
} from "../support/fakeConversationRepositories.ts";

Deno.test("ChannelService.listChannels returns channels with a null memberCount", () => {
  const rooms = new FakeConversationRepository(new FakeConversationMemberRepository());
  rooms.create({ id: "c-1", type: "channel", slug: "general", name: "General", isPublic: true });
  rooms.create({
    id: "c-2",
    type: "channel",
    slug: "programming",
    name: "Programming",
    isPublic: true,
  });

  const service = new ChannelService(rooms);
  const channels = service.listChannels();

  assertEquals(channels.length, 2);
  assertEquals(channels.every((c) => c.memberCount === null), true);
  assertEquals(channels.map((c) => c.slug).sort(), ["general", "programming"]);
});

Deno.test("ChannelService.listChannels does not include groups or DMs", () => {
  const memberRepo = new FakeConversationMemberRepository();
  const rooms = new FakeConversationRepository(memberRepo);
  rooms.create({ id: "c-1", type: "channel", slug: "general", isPublic: true });
  rooms.create({ id: "g-1", type: "group", name: "A group", isPublic: false });
  rooms.create({ id: "dm-1", type: "dm", isPublic: false });

  const service = new ChannelService(rooms);
  assertEquals(service.listChannels().length, 1);
});
