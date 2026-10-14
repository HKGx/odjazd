import { CityId } from "@odjazd/model";
import { Rpc, RpcGroup } from "effect/rpc";
import { Schema } from "effect";
import {
  BoardDto,
  BoardQuery,
  CompareQuery,
  ComparisonDto,
  LineRouteDto,
  LineRouteQuery,
  LiveDto,
  LoadResult,
  NearbyDto,
  NearbyQuery,
  JourneyDto,
  PlanDto,
  PlanQuery,
  RouteNowQuery,
  SectionDto,
  SectionLinesDto,
  SectionLinesQuery,
  SectionQuery,
  SearchHitDto,
  SearchQuery,
  StopBoardDto,
  StopBoardQuery,
  StopsDto,
  TripDto,
  TripQuery,
  TimetableNotLoaded,
  TimetableUnavailable,
} from "./schema.ts";

export class TimetableRpcs extends RpcGroup.make(
  Rpc.make("Load", {
    payload: { city: CityId },
    success: LoadResult,
    error: TimetableUnavailable,
  }),
  Rpc.make("Compare", { payload: CompareQuery, success: ComparisonDto, error: TimetableNotLoaded }),
  Rpc.make("Board", { payload: BoardQuery, success: BoardDto, error: TimetableNotLoaded }),
  Rpc.make("Search", {
    payload: SearchQuery,
    success: Schema.Array(SearchHitDto),
    error: TimetableNotLoaded,
  }),
  Rpc.make("Stops", {
    payload: { hash: Schema.String },
    success: StopsDto,
    error: TimetableNotLoaded,
  }),
  Rpc.make("Nearby", { payload: NearbyQuery, success: NearbyDto, error: TimetableNotLoaded }),
  Rpc.make("StopBoard", {
    payload: StopBoardQuery,
    success: StopBoardDto,
    error: TimetableNotLoaded,
  }),
  Rpc.make("LineRoute", {
    payload: LineRouteQuery,
    success: Schema.OptionFromNullOr(LineRouteDto),
    error: TimetableNotLoaded,
  }),
  Rpc.make("Plan", { payload: PlanQuery, success: PlanDto, error: TimetableNotLoaded }),
  Rpc.make("Section", { payload: SectionQuery, success: SectionDto, error: TimetableNotLoaded }),
  Rpc.make("SectionLines", {
    payload: SectionLinesQuery,
    success: SectionLinesDto,
    error: TimetableNotLoaded,
  }),
  Rpc.make("RouteNow", {
    payload: RouteNowQuery,
    success: Schema.Array(JourneyDto),
    error: TimetableNotLoaded,
  }),
  Rpc.make("Trip", {
    payload: TripQuery,
    success: Schema.OptionFromNullOr(TripDto),
    error: TimetableNotLoaded,
  }),
  /** Live vehicles for a city: the current state, then every change. Never fails; reconnects. */
  Rpc.make("Live", { payload: { city: CityId }, success: LiveDto, stream: true }),
) {}
