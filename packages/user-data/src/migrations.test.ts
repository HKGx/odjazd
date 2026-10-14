import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { migrate } from "./migrations.ts";
import { UserData } from "./schema.ts";

describe("migrate", () => {
  it("moves a v1 document to v2, dropping app-wide line preferences", () => {
    const v1 = {
      schemaVersion: 1,
      records: [],
      preferences: {
        walkingSpeedKmh: 5,
        transferBufferSec: 90,
        preferredLines: ["tram:10"],
        avoidedLines: [],
        preferencePenaltyMin: 4,
        theme: "dark",
        updatedAt: 7,
      },
      seeded: ["pl-lodz"],
    };
    const migrated = Schema.decodeUnknownSync(UserData)(migrate(v1));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.preferences).toEqual({
      walkingSpeedKmh: 5,
      transferBufferSec: 90,
      preferencePenaltyMin: 4,
      routeToleranceMin: 5,
      theme: "dark",
      updatedAt: 7,
    });
    expect(migrated.seeded).toEqual(["pl-lodz"]);
  });

  it("starts an empty document for version 0 and rejects newer ones", () => {
    expect(Schema.decodeUnknownSync(UserData)(migrate({})).records).toEqual([]);
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/newer/);
  });
});
