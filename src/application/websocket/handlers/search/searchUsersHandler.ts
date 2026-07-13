import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { SearchService } from "../../../../domain/search/searchService.ts";
import type { UserSummary } from "../../../../domain/users/user.entity.ts";
import type { AccountPolicy } from "../../../../domain/auth/accountPolicy.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import type { BlockPolicy, SanctionPolicy } from "../../../../domain/safety/safetyPolicy.ts";

/** docs/03-websocket-events.md "Module: Search" — `search.users`. */
export class SearchUsersHandler implements EventHandler {
  readonly event = "search.users";
  private readonly accountPolicy: Pick<AccountPolicy, "requireVerifiedEmail">;

  constructor(
    private readonly searchService: SearchService,
    accountPolicy?: Pick<AccountPolicy, "requireVerifiedEmail">,
    private readonly blockPolicy?: BlockPolicy,
    private readonly sanctionPolicy?: SanctionPolicy,
  ) {
    this.accountPolicy = accountPolicy ?? { requireVerifiedEmail() {} };
  }

  handle(ctx: HandlerContext, data: unknown): { users: UserSummary[] } {
    const body = asRecord(data, "search.users data");
    const query = requireString(body, "query", { minLength: 1, maxLength: 200 });
    this.accountPolicy.requireVerifiedEmail(ctx.userId);
    this.sanctionPolicy?.requireCanInteract(ctx.userId);

    return {
      users: this.searchService.searchUsers(query).filter((user) =>
        !this.blockPolicy?.isBlockedEitherDirection(ctx.userId, user.id)
      ),
    };
  }
}
