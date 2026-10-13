import { CityId } from "@odjazd/model";
import { Rpc, RpcGroup } from "effect/rpc";
import {
  BoardDto,
  BoardQuery,
  CompareQuery,
  ComparisonDto,
  LoadResult,
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
) {}
