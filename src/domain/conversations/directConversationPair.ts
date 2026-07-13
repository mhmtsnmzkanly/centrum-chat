import { ValidationError } from "../../shared/errors/validationError.ts";

export interface CanonicalDirectConversationPair {
  readonly userLowId: string;
  readonly userHighId: string;
}

/** Canonicalizes a user pair once, so services/repositories don't each re-implement the
 * same low/high comparison. Self-DM attempts are rejected here as a shared persistence rule. */
export function canonicalizeDirectConversationPair(
  userAId: string,
  userBId: string,
): CanonicalDirectConversationPair {
  if (userAId === userBId) {
    throw new ValidationError("Cannot open a DM with yourself.");
  }

  return userAId < userBId
    ? { userLowId: userAId, userHighId: userBId }
    : { userLowId: userBId, userHighId: userAId };
}
