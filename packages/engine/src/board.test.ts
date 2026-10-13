import type { EpochSeconds } from "@odjazd/model";
import { scheduleRealization } from "@odjazd/prediction";
import { StopTimeFlag } from "@odjazd/timetable";
import { describe, expect, it } from "vitest";
import { departuresFromArea } from "./board.ts";
import { area, at, buildTimetable } from "./test-timetable.ts";

const stops = [
  ["a1", 51.7, 19.46],
  ["a2", 51.7005, 19.46],
  ["c1", 51.72, 19.46],
] as const;

describe("departuresFromArea", () => {
  const timetable = buildTimetable(stops, [
    {
      line: "tram:1",
      id: "t1",
      stops: [
        ["a1", "08:10"],
        ["c1", "08:20"],
      ],
    },
    {
      line: "tram:2",
      id: "t2",
      stops: [
        ["a2", "08:05"],
        ["c1", "08:15"],
      ],
    },
    {
      line: "tram:3",
      id: "ends-here",
      stops: [
        ["c1", "08:00"],
        ["a1", "08:07"],
      ],
    },
    {
      line: "tram:4",
      id: "no-pickup",
      stops: [
        ["a1", "08:06", StopTimeFlag.noPickup],
        ["c1", "08:16"],
      ],
    },
    {
      line: "tram:5",
      id: "past",
      stops: [
        ["a1", "07:59"],
        ["c1", "08:09"],
      ],
    },
    {
      line: "tram:6",
      id: "far-future",
      stops: [
        ["a1", "09:30"],
        ["c1", "09:40"],
      ],
    },
  ]);
  const a = area("a", 51.7, 19.46);
  const board = (limit: number) =>
    departuresFromArea(
      timetable,
      scheduleRealization(timetable),
      a,
      at("08:00") as EpochSeconds,
      3600,
      limit,
    );

  it("lists departures from every member stop, soonest first", () => {
    expect(board(10).map((d) => [d.tripFeedId, d.departAt])).toEqual([
      ["t2", at("08:05")],
      ["t1", at("08:10")],
    ]);
  });

  it("respects the limit", () => {
    expect(board(1).map((d) => d.tripFeedId)).toEqual(["t2"]);
  });
});
