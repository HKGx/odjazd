import { Schema } from "effect";

/** Transport mode as riders see it (not GTFS route_type numbers). */
export const Mode = Schema.Literals([
  "tram",
  "bus",
  "trolleybus",
  "metro",
  "rail",
  "ferry",
  "cable_tram",
  "aerial_lift",
  "funicular",
  "monorail",
]);
export type Mode = typeof Mode.Type;

const modes: ReadonlySet<string> = new Set(Mode.literals);

/** Agency slug assigned in the city catalog (never a feed `agency_id`). */
export const AgencySlug = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).pipe(
  Schema.brand("AgencySlug"),
);
export type AgencySlug = typeof AgencySlug.Type;

// mode ":" public line number [ "@" agency ]
const linePattern = /^([a-z_]+):([^\s:@]+)(?:@([a-z0-9]+(?:-[a-z0-9]+)*))?$/;

export interface LineParts {
  readonly mode: Mode;
  readonly number: string;
  readonly agency: AgencySlug | undefined;
}

/** Splits a line reference into its parts, or `undefined` if malformed. */
export const parseLine = (text: string): LineParts | undefined => {
  const match = linePattern.exec(text);
  if (match === null) return undefined;
  const [, mode, number, agency] = match;
  if (mode === undefined || number === undefined || !modes.has(mode)) return undefined;
  return { mode: mode as Mode, number, agency: agency as AgencySlug | undefined };
};

/**
 * How users and leg rules name a line: `tram:12`, optionally pinned to an
 * agency (`tram:12@mpk-lodz`) when a city has several. Matches any agency
 * when unpinned. This is intent, resolved against the feed at query time.
 */
export const LineRef = Schema.String.check(
  Schema.makeFilter((text: string) => parseLine(text) !== undefined, {
    expected: "a line reference like tram:12 or tram:12@agency",
  }),
).pipe(Schema.brand("LineRef"));
export type LineRef = typeof LineRef.Type;

/**
 * Identity of a line in a normalized timetable: always agency-qualified,
 * `tram:12@mpk-lodz`. Stable across feed versions, unlike GTFS route_id.
 */
export const LineId = Schema.String.check(
  Schema.makeFilter((text: string) => parseLine(text)?.agency !== undefined, {
    expected: "an agency-qualified line id like tram:12@agency",
  }),
).pipe(Schema.brand("LineId"));
export type LineId = typeof LineId.Type;

/**
 * Builds a line id from a mode, a public line number (e.g. GTFS
 * route_short_name, trimmed) and an agency slug. Throws if the number is
 * empty or contains whitespace, `:` or `@`.
 */
export const makeLineId = (mode: Mode, number: string, agency: AgencySlug): LineId =>
  LineId.make(`${mode}:${number}@${agency}`);

/** Whether `ref` selects line `id`. Line numbers compare exactly (`Z1` ≠ `z1`). */
export const lineRefMatches = (ref: LineRef, id: LineId): boolean => {
  const r = parseLine(ref);
  const l = parseLine(id);
  if (r === undefined || l === undefined) return false;
  return (
    r.mode === l.mode && r.number === l.number && (r.agency === undefined || r.agency === l.agency)
  );
};
