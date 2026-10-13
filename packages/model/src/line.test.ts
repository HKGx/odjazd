import { describe, expect, it } from "vitest";
import { AgencySlug, LineId, LineRef, lineRefMatches, makeLineId, parseLine } from "./line.ts";

const mpk = AgencySlug.make("mpk-lodz");
const other = AgencySlug.make("other");

describe("parseLine", () => {
  it("splits unpinned and agency-pinned references", () => {
    expect(parseLine("tram:12")).toEqual({ mode: "tram", number: "12", agency: undefined });
    expect(parseLine("bus:Z1@mpk-lodz")).toEqual({ mode: "bus", number: "Z1", agency: "mpk-lodz" });
  });

  it.each([
    "12",
    "tram:",
    "tram:1 2",
    "ship:12",
    "tram:12@",
    "tram:12@MPK",
    "tram:12:3",
    "Tram:12",
  ])("rejects %j", (text) => expect(parseLine(text)).toBeUndefined());
});

describe("LineId vs LineRef", () => {
  it("LineId must be agency-qualified, LineRef need not be", () => {
    expect(LineRef.make("tram:12")).toBe("tram:12");
    expect(() => LineId.make("tram:12")).toThrow();
    expect(makeLineId("tram", "12", mpk)).toBe("tram:12@mpk-lodz");
  });

  it("makeLineId rejects unusable line numbers", () => {
    expect(() => makeLineId("bus", "", mpk)).toThrow();
    expect(() => makeLineId("bus", "N 1", mpk)).toThrow();
  });
});

describe("lineRefMatches", () => {
  const tram12 = makeLineId("tram", "12", mpk);

  it("unpinned refs match any agency", () => {
    expect(lineRefMatches(LineRef.make("tram:12"), tram12)).toBe(true);
    expect(lineRefMatches(LineRef.make("tram:12"), makeLineId("tram", "12", other))).toBe(true);
  });

  it("pinned refs match only their agency", () => {
    expect(lineRefMatches(LineRef.make("tram:12@mpk-lodz"), tram12)).toBe(true);
    expect(lineRefMatches(LineRef.make("tram:12@other"), tram12)).toBe(false);
  });

  it("mode and number must both match", () => {
    expect(lineRefMatches(LineRef.make("bus:12"), tram12)).toBe(false);
    expect(lineRefMatches(LineRef.make("tram:12A"), tram12)).toBe(false);
  });
});
