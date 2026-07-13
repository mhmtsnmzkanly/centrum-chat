import type { SafetyRepository } from "./safetyRepository.port.ts";
import type { AppRole, SanctionRecord } from "./safety.entity.ts";
import { ForbiddenError } from "../../shared/errors/forbiddenError.ts";
import {
  AccountSuspendedError,
  BlockedInteractionError,
  InteractionRestrictedError,
  MessageMutedError,
} from "./safetyErrors.ts";

export class ModerationPolicy {
  constructor(private readonly safety: SafetyRepository) {}

  requireModerator(userId: string): AppRole {
    const role = this.safety.getUserRole(userId);
    if (role !== "moderator" && role !== "admin" && role !== "owner") {
      throw new ForbiddenError("Moderator authority is required.");
    }
    return role;
  }

  requireAdmin(userId: string): "admin" | "owner" {
    const role = this.safety.getUserRole(userId);
    if (role !== "admin" && role !== "owner") {
      throw new ForbiddenError("Administrator authority is required.");
    }
    return role;
  }
}

export class BlockPolicy {
  constructor(private readonly safety: SafetyRepository) {}

  isBlockedEitherDirection(firstUserId: string, secondUserId: string): boolean {
    return this.safety.hasBlockEitherDirection(firstUserId, secondUserId);
  }

  requireDirectInteraction(firstUserId: string, secondUserId: string): void {
    if (this.isBlockedEitherDirection(firstUserId, secondUserId)) {
      throw new BlockedInteractionError("Direct interaction is unavailable.");
    }
  }
}

export class SanctionPolicy {
  constructor(
    private readonly safety: SafetyRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  active(userId: string): SanctionRecord[] {
    return this.safety.listActiveSanctions(userId, new Date(this.now()).toISOString());
  }

  requireApplicationAccess(userId: string): void {
    if (this.active(userId).some((item) => item.type === "account_suspension")) {
      throw new AccountSuspendedError("This account is suspended.");
    }
  }

  requireCanMessage(userId: string): void {
    this.requireApplicationAccess(userId);
    const sanctions = this.active(userId);
    if (sanctions.some((item) => item.type === "interaction_restriction")) {
      throw new InteractionRestrictedError("Interaction is restricted for this account.");
    }
    if (sanctions.some((item) => item.type === "message_mute")) {
      throw new MessageMutedError("Messaging is temporarily unavailable.");
    }
  }

  requireCanInteract(userId: string): void {
    this.requireApplicationAccess(userId);
    if (this.active(userId).some((item) => item.type === "interaction_restriction")) {
      throw new InteractionRestrictedError("Interaction is restricted for this account.");
    }
  }
}
