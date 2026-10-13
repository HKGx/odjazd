import type { Corridor, LineRef } from "@odjazd/model";
import type { Preferences } from "@odjazd/user-data";

/**
 * Folds the app-wide preferred and avoided lines into each leg. A leg's own
 * rules win: a line the leg prefers or explicitly allows is never avoided.
 */
export const withLinePreferences = (corridor: Corridor, preferences: Preferences): Corridor => {
  if (preferences.preferredLines.length === 0 && preferences.avoidedLines.length === 0) {
    return corridor;
  }
  const legs = corridor.legs.map((leg) => {
    const own = new Set<LineRef>([...(leg.prefer ?? []), ...(leg.allow.lines ?? [])]);
    const prefer = [...new Set([...(leg.prefer ?? []), ...preferences.preferredLines])];
    const avoid = [
      ...new Set([...(leg.avoid ?? []), ...preferences.avoidedLines.filter((l) => !own.has(l))]),
    ];
    return {
      ...leg,
      ...(prefer.length === 0 ? {} : { prefer }),
      ...(avoid.length === 0 ? {} : { avoid }),
    };
  });
  return { ...corridor, legs: legs as unknown as Corridor["legs"] };
};

/** The compare-query fields the preferences decide. */
export const queryPreferences = (preferences: Preferences) => ({
  transferBufferSec: preferences.transferBufferSec,
  walkingSpeedKmh: preferences.walkingSpeedKmh,
  preferencePenaltySec: preferences.preferencePenaltyMin * 60,
});
