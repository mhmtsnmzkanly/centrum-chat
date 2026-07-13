/**
 * Pure text-generation for group system-message events (docs/06-implementation-plan.md
 * Phase 4 "system messages" as a domain-layer test surface). GroupService returns this
 * text alongside its result; the group WS handlers (`createGroupHandler.ts` and
 * friends, via `groupBroadcast.ts`) are what actually persist it as a `messages` row and
 * broadcast `message.new` — this file only ever decides *what the text should say*,
 * decoupled from persistence/broadcast.
 */
export function groupCreatedMessage(creatorDisplayName: string): string {
  return `${creatorDisplayName} created the group.`;
}

export function memberAddedMessage(actorDisplayName: string, addedDisplayName: string): string {
  return `${actorDisplayName} added ${addedDisplayName} to the group.`;
}

export function memberRemovedMessage(actorDisplayName: string, removedDisplayName: string): string {
  return `${actorDisplayName} removed ${removedDisplayName} from the group.`;
}

export function memberLeftMessage(displayName: string): string {
  return `${displayName} left the group.`;
}

export function ownershipTransferredMessage(newOwnerDisplayName: string): string {
  return `${newOwnerDisplayName} is now the group owner.`;
}
