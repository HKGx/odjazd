import { describe, expect, it } from "vitest";
import { buildSearchIndex, nearbyGroups, normalize, search } from "./search.ts";
import { buildTimetable } from "./test-timetable.ts";

const base = buildTimetable(
  [
    ["p1", 51.7592, 19.4573],
    ["p2", 51.7596, 19.4579],
    ["p3", 51.8, 19.5],
    ["g1", 51.7516, 19.4555],
  ],
  [
    {
      line: "tram:10",
      id: "t1",
      stops: [
        ["p1", "08:00"],
        ["g1", "08:05"],
      ],
    },
    {
      line: "tram:2",
      id: "t2",
      stops: [
        ["p2", "08:00"],
        ["g1", "08:06"],
      ],
    },
    {
      line: "bus:58A",
      id: "t3",
      stops: [
        ["p3", "08:00"],
        ["g1", "08:10"],
      ],
    },
  ],
);
// Two platforms of one interchange, plus a namesake far away.
const timetable = {
  ...base,
  stops: {
    ...base.stops,
    names: ["Plac Niepodległości", "Plac Niepodległości", "Plac Niepodległości", "Górniak"],
  },
};
const index = buildSearchIndex(timetable);

describe("search", () => {
  it("normalizes Polish diacritics and punctuation", () => {
    expect(normalize("Łódź Kaliska, pl. Wolności")).toBe("lodz kaliska pl wolnosci");
  });

  it("groups nearby platforms with one name and keeps far namesakes apart", () => {
    const plac = index.groups.filter((group) => group.name === "Plac Niepodległości");
    expect(plac.map((group) => group.stops)).toEqual([[0, 1], [2]]);
    expect(index.groupOfStop[0]).toBe(index.groupOfStop[1]);
  });

  it("lists lines at a group, trams first, naturally ordered", () => {
    const gorniak = index.groups[index.groupOfStop[3] ?? 0];
    const labels = gorniak?.lines.map((line) => timetable.lines[line]?.id);
    expect(labels).toEqual(["tram:2@test", "tram:10@test", "bus:58A@test"]);
  });

  it("matches word prefixes without diacritics", () => {
    const hits = search(timetable, index, "niepodl", 10);
    expect(hits.filter((hit) => hit.kind === "stop")).toHaveLength(2);
    const gorniak = search(timetable, index, "gorn", 10);
    expect(gorniak[0]).toMatchObject({ kind: "stop", group: index.groupOfStop[3] });
  });

  it("ranks an exact line number first", () => {
    const hits = search(timetable, index, "10", 10);
    expect(hits[0]).toMatchObject({ kind: "line", line: 0 });
    expect(search(timetable, index, "58a", 10)[0]).toMatchObject({ kind: "line", line: 2 });
  });

  it("finds groups near a point", () => {
    const near = nearbyGroups(index, 51.7594, 19.4576, 500, 5);
    expect(near.map((hit) => hit.group)).toEqual(
      [index.groupOfStop[0], index.groupOfStop[3]].slice(0, near.length),
    );
    expect(near[0]?.group).toBe(index.groupOfStop[0]);
  });
});
