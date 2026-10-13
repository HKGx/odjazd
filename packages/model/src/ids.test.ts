import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { CityId, makeUlid, Ulid } from "./ids.ts";

describe("CityId", () => {
  it("accepts catalog slugs", () => {
    expect(CityId.make("pl-lodz")).toBe("pl-lodz");
    expect(CityId.make("pl-bielsko-biala")).toBe("pl-bielsko-biala");
  });

  it.each(["lodz", "PL-lodz", "pl-łódź", "pl-", "pl--lodz", "pl-lodz-"])("rejects %j", (text) =>
    expect(() => CityId.make(text)).toThrow(),
  );
});

describe("makeUlid", () => {
  it.effect("timestamps from the Effect clock", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-10-13T06:00:00Z"));
      const id = yield* makeUlid;
      expect(Ulid.make(id)).toBe(id);
      // First 10 chars encode the millisecond timestamp.
      const later = yield* TestClock.adjust("1 second").pipe(Effect.andThen(makeUlid));
      expect(later.slice(0, 10) > id.slice(0, 10)).toBe(true);
    }),
  );

  it.effect("is monotonic within one millisecond", () =>
    Effect.gen(function* () {
      const ids = yield* Effect.replicateEffect(makeUlid, 100);
      expect([...ids].sort()).toEqual(ids);
      expect(new Set(ids).size).toBe(100);
    }),
  );
});
