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

/** Served under `/api`; the web dev server proxies it, so no CORS. */
export class CitiesGroup extends HttpApiGroup.make("cities").add(
  HttpApiEndpoint.get("list", "/cities", { success: CityList }),
  HttpApiEndpoint.get("manifest", "/cities/:city/manifest", {
    params: { city: CityId },
    success: CityManifest,
    error: HttpApiError.NotFound,
  }),
) {}

/** Immutable, content-addressed timetable files (`<hash>.bin`), served gzip-encoded. */
export class FeedsGroup extends HttpApiGroup.make("feeds").add(
  HttpApiEndpoint.get("timetable", "/feeds/:file", {
    params: { file: Schema.String },
    success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    error: HttpApiError.NotFound,
  }),
) {}

export class OdjazdApi extends HttpApi.make("odjazd")
  .add(CitiesGroup)
  .add(FeedsGroup)
  .prefix("/api") {}
