import { CityId } from "@odjazd/model";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { CityList, CityManifest } from "./payloads.ts";
import { RealtimeEvent, RealtimeSnapshot } from "./realtime.ts";

/** Served under `/api`; the web dev server proxies it, so no CORS. */
export class CitiesGroup extends HttpApiGroup.make("cities").add(
  HttpApiEndpoint.get("list", "/cities", { success: CityList }),
  HttpApiEndpoint.get("manifest", "/cities/:city/manifest", {
    params: { city: CityId },
    success: CityManifest,
    error: HttpApiError.NotFound,
  }),
) {}

/** Immutable, content-addressed timetables (`<hash>.bin`) and street networks (`<hash>.walk`), gzip-encoded. */
export class FeedsGroup extends HttpApiGroup.make("feeds").add(
  HttpApiEndpoint.get("timetable", "/feeds/:file", {
    params: { file: Schema.String },
    success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    error: HttpApiError.NotFound,
  }),
) {}

/** Live vehicles, polled server-side (feeds there send no CORS headers). */
export class RealtimeGroup extends HttpApiGroup.make("realtime").add(
  HttpApiEndpoint.get("snapshot", "/rt/:city/snapshot", {
    params: { city: CityId },
    success: RealtimeSnapshot,
    error: HttpApiError.NotFound,
  }),
  HttpApiEndpoint.get("stream", "/rt/:city/stream", {
    params: { city: CityId },
    success: HttpApiSchema.StreamSse({ data: RealtimeEvent }),
    error: HttpApiError.NotFound,
  }),
) {}

export class OdjazdApi extends HttpApi.make("odjazd")
  .add(CitiesGroup)
  .add(FeedsGroup)
  .add(RealtimeGroup)
  .prefix("/api") {}
