import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { decodeTripUpdates, decodeVehiclePositions } from "./decode.ts";
import { FeedMessageSchema, VehiclePosition_VehicleStopStatus } from "./gen/gtfs-realtime_pb.ts";

const header = { gtfsRealtimeVersion: "2.0", timestamp: 1_791_912_379n };

describe("decodeVehiclePositions", () => {
  it("keeps set fields and leaves unset ones undefined", () => {
    const bytes = toBinary(
      FeedMessageSchema,
      create(FeedMessageSchema, {
        header,
        entity: [
          {
            id: "vehicle_1002",
            vehicle: {
              trip: { tripId: "11527_3920", routeId: "58A" },
              vehicle: { id: "1002", label: "1002" },
              position: { latitude: 51.7756, longitude: 19.5118, speed: 10.8 },
              currentStopSequence: 12,
              currentStatus: VehiclePosition_VehicleStopStatus.STOPPED_AT,
              stopId: "2823",
              timestamp: 1_791_912_370n,
            },
          },
          // No status, no speed, no vehicle descriptor.
          { id: "e2", vehicle: { position: { latitude: 51.7, longitude: 19.4 } } },
          // No position at all: dropped.
          { id: "e3", vehicle: { trip: { tripId: "x" } } },
        ],
      }),
    );
    const feed = decodeVehiclePositions(bytes);
    expect(feed.timestamp).toBe(1_791_912_379);
    expect(feed.entities).toHaveLength(2);
    expect(feed.entities[0]).toMatchObject({
      id: "1002",
      tripId: "11527_3920",
      routeId: "58A",
      stopId: "2823",
      stopSequence: 12,
      status: "stopped",
      bearing: undefined,
      timestamp: 1_791_912_370,
    });
    expect(feed.entities[0]?.speed).toBeCloseTo(10.8, 3);
    expect(feed.entities[1]).toMatchObject({
      id: "e2",
      tripId: undefined,
      status: undefined,
      speed: undefined,
      stopSequence: undefined,
    });
  });
});

describe("decodeTripUpdates", () => {
  it("reads arrival-only delays and tells a set zero from unset", () => {
    const bytes = toBinary(
      FeedMessageSchema,
      create(FeedMessageSchema, {
        header,
        entity: [
          {
            id: "trip_11527_3981",
            tripUpdate: {
              trip: { tripId: "11527_3981", routeId: "58B" },
              vehicle: { id: "1003" },
              stopTimeUpdate: [
                { stopSequence: 27, stopId: "2991", arrival: { delay: 563 } },
                { stopSequence: 28, arrival: { delay: 0 } },
                { stopSequence: 29, arrival: { time: 1_791_912_999n } },
              ],
            },
          },
        ],
      }),
    );
    const [update] = decodeTripUpdates(bytes).entities;
    expect(update?.tripId).toBe("11527_3981");
    expect(update?.vehicleId).toBe("1003");
    expect(update?.stops.map((stop) => stop.arrivalDelay)).toEqual([563, 0, undefined]);
    expect(update?.stops[0]?.departureDelay).toBeUndefined();
  });
});
