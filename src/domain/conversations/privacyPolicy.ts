import type { DmPrivacy, GroupPrivacy } from "../preferences/preferences.entity.ts";

/**
 * Pure privacy-gating logic for `dm.open` / `group.addMember`
 * (docs/03-websocket-events.md), deliberately free of any repository/DB dependency so
 * it's directly unit-testable as its own policy function (docs/06-implementation-plan.md
 * Phase 4). Callers resolve the booleans from repositories, then ask these functions
 * "is this allowed".
 */
export function canOpenDm(
  targetDmPrivacy: DmPrivacy,
  actorSharesGroupWithTarget: boolean,
): boolean {
  switch (targetDmPrivacy) {
    case "everyone":
      return true;
    case "group_members":
      return actorSharesGroupWithTarget;
    case "no_one":
      return false;
  }
}

export function canAddToGroup(
  targetGroupPrivacy: GroupPrivacy,
  actorHasDmWithTarget: boolean,
): boolean {
  switch (targetGroupPrivacy) {
    case "everyone":
      return true;
    case "dm_contacts":
      return actorHasDmWithTarget;
    case "no_one":
      return false;
  }
}
