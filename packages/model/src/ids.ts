import { Clock, Effect, Schema } from "effect";
import { monotonicFactory } from "ulid";

/** Stable city slug from the catalog: ISO country code + name, e.g. `pl-lodz`. */
export const CityId = Schema.String.check(
  Schema.isPattern(/^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/),
).pipe(Schema.brand("CityId"));
export type CityId = typeof CityId.Type;

/** Identifier of every user-data record. Sortable by creation time. */
export const Ulid = Schema.String.check(Schema.isPattern(/^[0-9A-HJKMNP-TV-Z]{26}$/)).pipe(
  Schema.brand("Ulid"),
);
export type Ulid = typeof Ulid.Type;

const nextUlid = monotonicFactory();

/**
 * A fresh ULID timestamped from the Effect `Clock`, so replay and tests control
 * it. Monotonic: IDs made within the same millisecond still sort in order.
 */
export const makeUlid: Effect.Effect<Ulid> = Effect.map(Clock.currentTimeMillis, (millis) =>
  Ulid.make(nextUlid(millis)),
);
