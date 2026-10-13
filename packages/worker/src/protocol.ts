import type { CityManifest } from "@odjazd/api";
import type { CorridorSummary } from "@odjazd/engine";
import type { CityId, Corridor, InterchangeArea, Mode, TimeZone } from "@odjazd/model";

/*
 * Main thread ↔ timetable worker. Plain structured-clone messages: the
 * timetable never leaves the worker, only small DTOs do. Intent (areas,
 * corridors) travels in its encoded form and is decoded on arrival.
 */

export interface LoadRequest {
  readonly kind: "load";
  /** Origin the API is served from, e.g. `location.origin`. */
  readonly apiBase: string;
  readonly city: CityId;
}

export interface LoadResult {
  readonly manifest: CityManifest;
  /** `cache` when the network was unreachable and a stored copy was used. */
  readonly source: "network" | "cache";
  readonly timeZone: TimeZone;
  readonly stats: { readonly lines: number; readonly stops: number; readonly trips: number };
  /** Service dates the timetable covers, first and last inclusive. */
  readonly firstDate: string;
  readonly lastDate: string;
}

export interface CompareRequest {
  readonly kind: "compare";
  readonly areas: ReadonlyArray<typeof InterchangeArea.Encoded>;
  readonly corridors: ReadonlyArray<typeof Corridor.Encoded>;
  /** Service date, `YYYY-MM-DD`. */
  readonly date: string;
  /** Wall-clock `HH:MM` in the city's time zone. */
  readonly from: string;
  readonly to: string;
  readonly stepMinutes: number;
  readonly transferBufferSec: number;
}

export interface LineLabel {
  readonly id: string;
  /** Short name as riders know it, e.g. `12`. */
  readonly label: string;
  readonly mode: Mode;
}

export interface LegDto extends LineLabel {
  readonly headsign: string;
  readonly boardStop: string;
  readonly alightStop: string;
  readonly departAt: number;
  readonly arriveAt: number;
  readonly walkSec: number;
  readonly waitSec: number;
  readonly stayedAboard: boolean;
}

export interface ItineraryDto {
  readonly departAt: number;
  readonly arriveAt: number;
  readonly legs: ReadonlyArray<LegDto>;
}

export interface CorridorDto {
  readonly slug: string;
  readonly name: string;
  readonly legs: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly lines: ReadonlyArray<LineLabel & { readonly instances: number }>;
  }>;
}

export interface ComparisonDto {
  readonly date: string;
  readonly timeZone: TimeZone;
  /** False when the date lies outside the loaded timetable. */
  readonly inRange: boolean;
  readonly corridors: ReadonlyArray<CorridorDto>;
  /** Corridors left out because they reference unknown areas, with the reason. */
  readonly rejected: ReadonlyArray<{ readonly slug: string; readonly reason: string }>;
  readonly rows: ReadonlyArray<{
    readonly departAt: number;
    /** One per corridor in `corridors`; null where it has no service. */
    readonly results: ReadonlyArray<ItineraryDto | null>;
  }>;
  readonly summaries: ReadonlyArray<CorridorSummary>;
}

export interface BoardRequest {
  readonly kind: "board";
  readonly area: typeof InterchangeArea.Encoded;
  /** Epoch seconds. */
  readonly at: number;
  readonly horizonMinutes: number;
  readonly limit: number;
}

export interface BoardDto {
  readonly stops: ReadonlyArray<{ readonly name: string; readonly distanceMeters: number }>;
  readonly departures: ReadonlyArray<
    LineLabel & { readonly headsign: string; readonly stop: string; readonly departAt: number }
  >;
}

export type WorkerRequest = LoadRequest | CompareRequest | BoardRequest;

export interface WorkerResponses {
  readonly load: LoadResult;
  readonly compare: ComparisonDto;
  readonly board: BoardDto;
}

export type Envelope = { readonly id: number; readonly request: WorkerRequest };

export type Reply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };
