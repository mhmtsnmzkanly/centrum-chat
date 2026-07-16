# CentrumChat Server — WebSocket Event Catalog (protocol v1.0, JSON)

## Connection lifecycle

`wss://host/ws?token=<accessJwt>` — the JWT obtained from `POST /api/auth/login` (see
`04-http-api.md`) is passed as a query param. The transport layer validates it during the HTTP
upgrade, *before* accepting the socket; an invalid/expired/missing token gets the upgrade rejected
with HTTP 401 (no socket is ever opened for an unauthenticated client — there is no in-band
`authenticate` event to keep the handler set simple). On successful upgrade the Connection Manager
atomically admits the socket under the token's `userId` and the real peer IP, enforcing configured
concurrent connection caps before the upgrade completes. On successful open it marks the user
`online` if this is their first active connection, broadcasting `presence.updated` to relevant
rooms.

Heartbeat is **application-level**, not native WebSocket protocol ping/pong: the server sends an
unsolicited `system.ping` push on idle connections every `WS_HEARTBEAT_INTERVAL_MS`, and the client
responds with a normal `system.pong` request. Valid inbound envelopes refresh the connection's idle
timer; malformed payloads do not. A connection with no valid inbound activity for
`WS_IDLE_TIMEOUT_MS` is closed and treated as a disconnect.

## Envelope

Client → Server:
```json
{ "id": "c-1a2b3c", "event": "message.send", "data": { "...": "..." } }
```

Server → Client, response to a request (correlated by echoing `id`):
```json
{ "id": "c-1a2b3c", "event": "message.send", "success": true, "data": { "...": "..." } }
{ "id": "c-1a2b3c", "event": "message.send", "success": false, "error": { "code": "VALIDATION_ERROR", "message": "content must not be empty", "details": { "field": "content" } } }
```

Server → Client, unsolicited push (no `id`):
```json
{ "event": "message.new", "data": { "...": "..." } }
```

The server may also close an authenticated socket without another application payload if:

- the per-user or per-IP connection cap rejects the upgrade
- outbound `bufferedAmount` exceeds `WS_MAX_BUFFERED_AMOUNT_BYTES` (slow client)
- the connection exceeds the malformed-packet strike threshold
- the connection exceeds the inbound packet-size limit
- the lifecycle job declares the connection stale
- the process is shutting down

## Common types referenced below

```ts
type UserSummary = { id, username, displayName, avatarSeed, avatarUrl, nameColor, status };
type Message = {
  id, conversationId, authorId: string | null, content, replyToId: string | null,
  isSystem: boolean, edited: boolean, deletedAt: string | null,
  createdAt: string, reactions: { emoji: string; userIds: string[] }[],
  attachments: Attachment[]
};
type Attachment = { id, fileName, mimeType, sizeBytes, url };
type Conversation = { id, type: 'channel'|'group'|'dm', slug, name, topic, ownerId, memberCount, createdAt };
```

---

## Module: Presence

| Event (C→S) | data | Notes |
|---|---|---|
| `presence.update` | `{ status: 'online'\|'idle'\|'dnd'\|'offline' }` | Explicit user-driven status change. |

| Event (S→C push) | data |
|---|---|
| `presence.updated` | `{ userId, status, lastSeenAt }` — broadcast to every room the user shares with others. |

## Module: Channels

Channels are public: any authenticated user may read and post in any channel at any time. There is
no join/leave action and no membership check — every connected client implicitly receives
`message.new` pushes for every channel (see architecture doc §13, Connection Manager fan-out).

| Event (C→S) | data | Response `data` |
|---|---|---|
| `channel.list` | `{}` | `{ channels: Conversation[] }` — all public channels; `memberCount` is omitted/null for channels since membership isn't tracked. |

## Module: Groups

| Event (C→S) | data | Response `data` |
|---|---|---|
| `group.list` | `{}` | `{ groups: Conversation[] }` — groups the caller belongs to. |
| `group.create` | `{ name, memberIds: string[] }` | `{ room: Conversation }` — verified accounts only; enforces 3–25 total members (creator + memberIds), emits a system message. |
| `group.addMember` | `{ groupId, userId }` | `{}` — verified accounts only; owner/moderator only; subject to target's `groupPrivacy`; emits a system message. |
| `group.removeMember` | `{ groupId, userId }` | `{}` — verified accounts only; owner only. |
| `group.leave` | `{ groupId }` | `{}` — ownership transfers to oldest remaining member if owner leaves; room deleted if last member leaves. |
| `group.members` | `{ groupId }` | `{ members: UserSummary[] }` — caller must be a member. |

| Event (S→C push) | data |
|---|---|
| `room.updated` | `{ room: Conversation }` — membership/name/topic change, sent to all current (and, for removal, the removed) members. |

## Module: Direct Messages

| Event (C→S) | data | Response `data` |
|---|---|---|
| `dm.open` | `{ userId }` | `{ room: Conversation }` — verified accounts only; gets-or-creates the canonical DM room for the pair; subject to target's `dmPrivacy`. |
| `dm.list` | `{}` | `{ rooms: Conversation[] }` — DM rooms with recent-activity ordering. |

## Module: Messages

| Event (C→S) | data | Response `data` |
|---|---|---|
| `message.send` | `{ conversationId, content, replyToId?, attachmentId? }` | `{ message: Message }` — verified accounts only. `attachmentId` refers to a prior `POST /api/media/upload` result. For `channel` rooms, any authenticated user may send (no membership check); for `group`/`dm` rooms, caller must have a `conversation_memberships` row (`FORBIDDEN` otherwise). Rate-limited. |
| `message.edit` | `{ messageId, content }` | `{ message: Message }` — author-only, any room type. |
| `message.delete` | `{ messageId }` | `{}` — author, or (group/dm) room owner/moderator, or (channel) a user holding an optional `role='moderator'` row for that channel; soft delete. |
| `message.history` | `{ conversationId, before?: string /* message id cursor */, limit?: number (default 50, max 100) }` | `{ messages: Message[], hasMore: boolean }` — descending-then-reversed page ending just before `before`. Channels: readable by any authenticated user. Group/DM: caller must be a member. |
| `room.markRead` | `{ conversationId, messageId }` | `{}` — upserts `conversation_reads.last_read_message_id` for `(conversationId, callerId)`; works for all room types, including channels, since it's decoupled from `conversation_memberships`. Clears unread counter. |

| Event (S→C push) | data |
|---|---|
| `message.new` | `{ message: Message }` — sent to all members of `message.conversationId` currently connected. |
| `message.updated` | `{ message: Message }` — edit or soft-delete result. |
| `unread.updated` | `{ conversationId, count }` — sent to a member when their unread count for a room changes (not sent to the room at large). |

## Module: Reactions

| Event (C→S) | data | Response `data` |
|---|---|---|
| `reaction.toggle` | `{ messageId, emoji }` | `{ reactions: Message['reactions'] }` — verified accounts only; adds if caller hasn't reacted with that emoji, removes if they have (matches frontend's toggle semantics). |

| Event (S→C push) | data |
|---|---|
| `reaction.updated` | `{ messageId, reactions: Message['reactions'] }` |

## Module: Typing Indicators

| Event (C→S) | data |
|---|---|
| `typing.start` | `{ conversationId }` |
| `typing.stop` | `{ conversationId }` |

Fire-and-forget (no response envelope beyond the standard ack `success:true, data:{}`).

| Event (S→C push) | data |
|---|---|
| `typing.updated` | `{ conversationId, userId, isTyping: boolean }` — server auto-expires a `typing.start` after 6s of silence and emits `isTyping:false` if no `typing.stop` arrives. |

## Module: Notifications

| Event (C→S) | data | Response `data` |
|---|---|---|
| `notification.list` | `{ unreadOnly?: boolean }` | `{ notifications: Notification[] }` |
| `notification.markRead` | `{ notificationId }` \| `{ all: true }` | `{}` |
| `notification.delete` | `{ ids: string[] }` (max 100) or `{ all: true }` (exclusively one of the two, not both) | `{ deletedCount: number }` — deletes only the caller's own notifications; foreign or unknown ids are silently skipped. |

```ts
type Notification = { id, type: 'mention'|'dm'|'group_invite'|'reaction', conversationId, messageId, isRead, createdAt };
```

| Event (S→C push) | data |
|---|---|
| `notification.new` | `{ notification: Notification }` — created on DM message, @mention in a channel/group, or group invite. |

## Module: Search

| Event (C→S) | data | Response `data` |
|---|---|---|
| `search.messages` | `{ conversationId, query }` | `{ messages: Message[] }` — scoped to one room (matches frontend behavior of searching only the active destination). |
| `search.users` | `{ query }` | `{ users: UserSummary[] }` — verified accounts only. |

## Module: Profile / Preferences

| Event (C→S) | data | Response `data` |
|---|---|---|
| `profile.get` | `{ userId }` | `{ profile: Profile }` |
| `profile.update` | `{ displayName?, bio?, avatarSeed?, nameColor?, coverIndex?, isPremium? }` | `{ profile: Profile }` — self only. |
| `preferences.get` | `{}` | `{ preferences: Preferences }` |
| `preferences.update` | `{ sound?, desktopNotifications?, dmPrivacy?, groupPrivacy?, theme?, locale? }` | `{ preferences: Preferences }` |

```ts
type Profile = UserSummary & { bio, joinedDate: string, isPremium, messagesSent, reactionsAdded, repliesMade };
type Preferences = { sound, desktopNotifications, dmPrivacy, groupPrivacy, theme, locale: "en" | "tr" | null };
```

## Standard error codes

`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`,
`EMAIL_VERIFICATION_REQUIRED`, `ONBOARDING_REQUIRED`, `INTERNAL_ERROR`. Every handler failure maps to one of these via the application-layer error
boundary (see architecture doc §7) — a client never needs to branch on anything else.

## Module: System

| Event (C→S) | data | Response `data` |
|---|---|---|
| `system.pong` | `{}` | `{}` — heartbeat acknowledgement used only by the transport lifecycle. Clients should answer automatically and never surface it to the user. |

| Event (S→C push) | data |
|---|---|
| `system.ping` | `{}` — application-level heartbeat challenge. Not a chat event; should not produce UI toasts/messages/state changes. |
## Safety enforcement

Existing mutation events may return `BLOCKED_INTERACTION`, `MESSAGE_MUTED`,
`INTERACTION_RESTRICTED`, or `ACCOUNT_SUSPENDED`. Suspended connections are closed and cannot dispatch
normal events; `system.pong` remains lifecycle-only. There are no moderator command WebSocket events.

## Runtime administration policy

Archived channels remain readable for history but reject message send/edit/delete and reaction
mutations and are omitted from `channel.list`. Maintenance mode blocks normal application mutation
events for every role while preserving reads and `system.pong`; permission-protected moderation and
Control Center HTTP operations remain available. Role and setting changes take effect on the next
authorization check. No
administration WebSocket command API is added.
