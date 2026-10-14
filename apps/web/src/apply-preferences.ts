import type { Preferences } from "@odjazd/user-data";

/** The query fields the preferences decide; line choices live on each route's legs. */
export const queryPreferences = (preferences: Preferences) => ({
  transferBufferSec: preferences.transferBufferSec,
  walkingSpeedKmh: preferences.walkingSpeedKmh,
  preferencePenaltySec: preferences.preferencePenaltyMin * 60,
});
