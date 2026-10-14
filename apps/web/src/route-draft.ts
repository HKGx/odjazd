import {
  AreaSlug,
  type CityId,
  type Corridor,
  distanceMeters,
  type InterchangeArea,
  type LegRule,
  LineRef,
  type Mode,
} from "@odjazd/model";
import type { JourneyDto } from "@odjazd/worker";
import { slugify } from "./slug.ts";

/*
 * A route being edited: areas in travel order and a rule for each hop
 * between neighbours. Hop rules are keyed by the pair of areas, so moving an
 * area around keeps the rules of the hops that still exist.
 */

export interface DraftArea {
  readonly area: InterchangeArea;
  /** Already in the store (possibly shared with other routes). */
  readonly saved: boolean;
}

export interface HopRule {
  readonly prefer: ReadonlyArray<LineRef>;
  readonly avoid: ReadonlyArray<LineRef>;
  /** Take only the preferred lines (plus `allowed`), never others. */
  readonly only: boolean;
  /** With `only`: further lines that may be taken without being preferred. */
  readonly allowed?: ReadonlyArray<LineRef> | undefined;
  /** Only these modes; any when empty. */
  readonly modes: ReadonlyArray<Mode>;
  readonly maxWalkMin?: number | undefined;
}

export interface RouteDraft {
  readonly name: string;
  readonly areas: ReadonlyArray<DraftArea>;
  readonly hops: ReadonlyMap<string, HopRule>;
}

export const anyLine: HopRule = { prefer: [], avoid: [], only: false, modes: [] };

export const emptyDraft: RouteDraft = { name: "", areas: [], hops: new Map() };

export const hopKey = (from: string, to: string) => `${from}>${to}`;

/** The hops of a draft in order, with their rules (defaults where unset). */
export const hopsOf = (draft: RouteDraft) =>
  draft.areas.slice(1).map((to, i) => {
    const from = (draft.areas[i] as DraftArea).area;
    return { from, to: to.area, rule: draft.hops.get(hopKey(from.slug, to.area.slug)) ?? anyLine };
  });

/** A line as a route remembers it: mode and number, any operator. */
export const lineRef = (line: { readonly mode: Mode; readonly label: string }): LineRef =>
  LineRef.make(`${line.mode}:${line.label}`);

export type ChipState = "any" | "preferred" | "avoided";

export const chipState = (rule: HopRule, ref: LineRef): ChipState =>
  rule.prefer.includes(ref) ? "preferred" : rule.avoid.includes(ref) ? "avoided" : "any";

/** any → preferred → avoided → any. */
export const cycleChip = (current: HopRule, ref: LineRef): HopRule => {
  let rule = current;
  const prefer = rule.prefer.filter((r) => r !== ref);
  const avoid = rule.avoid.filter((r) => r !== ref);
  rule = { ...rule, allowed: rule.allowed?.filter((r) => r !== ref) };
  switch (chipState(rule, ref)) {
    case "any":
      return { ...rule, prefer: [...prefer, ref], avoid };
    case "preferred":
      return { ...rule, prefer, avoid: [...avoid, ref] };
    case "avoided":
      return { ...rule, prefer, avoid };
  }
};

export const fromCorridor = (
  corridor: Corridor,
  saved: ReadonlyArray<InterchangeArea>,
): RouteDraft => {
  const bySlug = new Map(saved.map((area) => [area.slug as string, area]));
  const slugs = [corridor.legs[0].from, ...corridor.legs.map((leg) => leg.to)];
  return {
    name: corridor.name,
    // A missing area can't be drawn or timed; the editor shows the rest.
    areas: slugs.flatMap((slug) => {
      const area = bySlug.get(slug);
      return area === undefined ? [] : [{ area, saved: true }];
    }),
    hops: new Map(
      corridor.legs.map((leg) => [
        hopKey(leg.from, leg.to),
        {
          prefer:
            leg.allow.lines === undefined ? (leg.prefer ?? []) : (leg.prefer ?? leg.allow.lines),
          avoid: leg.avoid ?? [],
          only: leg.allow.lines !== undefined,
          allowed: leg.allow.lines?.filter(
            (line) => !(leg.prefer ?? leg.allow.lines)?.includes(line),
          ),
          modes: leg.allow.modes ?? [],
          maxWalkMin: leg.maxWalkMin,
        },
      ]),
    ),
  };
};

const legOf = (from: InterchangeArea, to: InterchangeArea, rule: HopRule): LegRule => {
  const only = rule.only && rule.prefer.length > 0;
  const allowed = only ? (rule.allowed ?? []) : [];
  return {
    from: from.slug,
    to: to.slug,
    allow: {
      ...(rule.modes.length === 0 ? {} : { modes: rule.modes }),
      ...(only ? { lines: [...rule.prefer, ...allowed] } : {}),
    },
    // Only-these-lines already means "these"; a preference among them needs saying.
    ...(rule.prefer.length === 0 || (only && allowed.length === 0) ? {} : { prefer: rule.prefer }),
    ...(rule.avoid.length === 0 ? {} : { avoid: rule.avoid }),
    ...(rule.maxWalkMin === undefined ? {} : { maxWalkMin: rule.maxWalkMin }),
  };
};

/** The corridor a draft describes, for validation; needs two areas. */
export const toCorridor = (
  draft: RouteDraft,
  slug: string,
  cityId: CityId,
): typeof Corridor.Encoded => ({
  slug,
  cityId,
  name: draft.name.trim(),
  // Empty for fewer than two areas; the schema rejects that.
  legs: hopsOf(draft).map((hop) =>
    legOf(hop.from, hop.to, hop.rule),
  ) as unknown as (typeof Corridor.Encoded)["legs"],
});

/** What's wrong with a draft, in the user's terms; `undefined` when it can be saved. */
export const draftProblem = (draft: RouteDraft): string | undefined => {
  if (draft.areas.length < 2)
    return "Add at least two areas: where you get on and where you get off.";
  for (const hop of hopsOf(draft)) {
    if (hop.from.slug === hop.to.slug) return `${hop.from.name} follows itself; remove one.`;
  }
  if (draft.name.trim() === "") return "Give the route a name.";
  return undefined;
};

/** A saved area that already covers a point, so routes share areas rather than duplicate them. */
export const areaCovering = (
  saved: ReadonlyArray<InterchangeArea>,
  point: { readonly lat: number; readonly lon: number },
) =>
  saved
    .map((area) => ({
      area,
      d: distanceMeters(point.lat, point.lon, area.center.lat, area.center.lon),
    }))
    .filter(({ area, d }) => d <= area.radiusMeters)
    .sort((a, b) => a.d - b.d)[0]?.area;

/** A new area for the draft, with a slug free among saved and draft areas. */
export const newArea = (
  draft: RouteDraft,
  saved: ReadonlyArray<InterchangeArea>,
  cityId: CityId,
  name: string,
  center: { readonly lat: number; readonly lon: number },
  radiusMeters = 150,
): DraftArea => {
  const taken = new Set([...saved, ...draft.areas.map((d) => d.area)].map((a) => a.slug));
  return {
    area: { slug: AreaSlug.make(slugify(name, taken)), cityId, name, center, radiusMeters },
    saved: false,
  };
};

/**
 * Adds an area at the end: a saved one covering the point if there is one,
 * otherwise a new one. Adding the area that's already last does nothing.
 */
export const appendArea = (
  draft: RouteDraft,
  saved: ReadonlyArray<InterchangeArea>,
  cityId: CityId,
  name: string,
  center: { readonly lat: number; readonly lon: number },
  radiusMeters?: number,
): RouteDraft => {
  // Tapping where the route already ends (e.g. the same stop twice) adds nothing.
  const last = draft.areas[draft.areas.length - 1];
  if (last !== undefined && areaCovering([last.area], center) !== undefined) return draft;
  const existing = areaCovering(saved, center);
  const added =
    existing === undefined
      ? newArea(draft, saved, cityId, name, center, radiusMeters)
      : { area: existing, saved: true };
  if (last?.area.slug === added.area.slug) return draft;
  return { ...draft, areas: [...draft.areas, added] };
};

/**
 * A route that repeats a planned journey: an area where each ride starts
 * and ends (one area where an alight and the next boarding are close), each
 * hop preferring the line that was taken.
 */
export const fromJourney = (
  journey: JourneyDto,
  saved: ReadonlyArray<InterchangeArea>,
  cityId: CityId,
): RouteDraft => {
  const rides = journey.legs.flatMap((leg) =>
    leg._tag === "Ride" && !leg.stayAboard ? [leg] : [],
  );
  const first = rides[0];
  if (first === undefined) return emptyDraft;
  // Where one ride ends and the next begins becomes one area covering both.
  const nodes: Array<Pick<InterchangeArea, "name" | "center" | "radiusMeters">> = [
    first.section.from,
  ];
  rides.forEach((ride, i) => {
    const next = rides[i + 1]?.section.from;
    const end = ride.section.to;
    if (next === undefined) return nodes.push(end);
    const gap = distanceMeters(end.center.lat, end.center.lon, next.center.lat, next.center.lon);
    if (gap <= end.radiusMeters) return nodes.push(end);
    return nodes.push({
      name: end.name,
      center: {
        lat: (end.center.lat + next.center.lat) / 2,
        lon: (end.center.lon + next.center.lon) / 2,
      },
      radiusMeters: Math.min(500, Math.round(gap / 2 + Math.max(end.radiusMeters, 120))),
    });
  });
  let draft: RouteDraft = emptyDraft;
  const at = nodes.map((node) => {
    draft = appendArea(draft, saved, cityId, node.name, node.center, node.radiusMeters);
    return draft.areas.length - 1;
  });
  const hops = new Map<string, HopRule>();
  rides.forEach((ride, i) => {
    const from = draft.areas[at[i] ?? 0]?.area.slug;
    const to = draft.areas[at[i + 1] ?? 0]?.area.slug;
    if (from !== undefined && to !== undefined && from !== to) {
      hops.set(hopKey(from, to), { ...anyLine, prefer: [lineRef(ride.line)] });
    }
  });
  const names = draft.areas.map((d) => d.area.name);
  return {
    name: names.length < 2 ? "" : `${names[0] ?? ""} → ${names[names.length - 1] ?? ""}`,
    areas: draft.areas,
    hops,
  };
};

/** Moves an area one place up or down. */
export const moveArea = (draft: RouteDraft, index: number, by: -1 | 1): RouteDraft => {
  const target = index + by;
  if (target < 0 || target >= draft.areas.length) return draft;
  const areas = [...draft.areas];
  [areas[index], areas[target]] = [areas[target] as DraftArea, areas[index] as DraftArea];
  return { ...draft, areas };
};

export const removeArea = (draft: RouteDraft, index: number): RouteDraft => ({
  ...draft,
  areas: draft.areas.filter((_, i) => i !== index),
});

export const setHop = (draft: RouteDraft, from: string, to: string, rule: HopRule): RouteDraft => ({
  ...draft,
  hops: new Map([...draft.hops, [hopKey(from, to), rule]]),
});
