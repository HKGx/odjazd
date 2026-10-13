import { fromBinary, isFieldSet } from "@bufbuild/protobuf";
import {
  FeedMessageSchema,
  PositionSchema,
  TripUpdate_StopTimeEventSchema,
  TripUpdate_StopTimeUpdateSchema,
  VehiclePosition_VehicleStopStatus,
  VehiclePositionSchema,
} from "./gen/gtfs-realtime_pb.ts";

/*
 * GTFS-RT to plain records, keeping only what the feed actually set. Proto2
 * defaults make unset fields read as values (an unset current_status reads
 * IN_TRANSIT_TO, an unset delay reads 0), so presence is checked explicitly.
 */

export type VehicleStopStatus = "incoming" | "stopped" | "in_transit";

export interface RawVehicle {
  /** Vehicle id, or the entity id when the feed has none. */
  readonly id: string;
  readonly label: string | undefined;
  readonly tripId: string | undefined;
  readonly routeId: string | undefined;
  readonly lat: number;
  readonly lon: number;
  /** Degrees clockwise from north. */
  readonly bearing: number | undefined;
  /** Meters per second. */
  readonly speed: number | undefined;
  readonly stopId: string | undefined;
  readonly stopSequence: number | undefined;
  readonly status: VehicleStopStatus | undefined;
  /** Epoch seconds of the position fix. */
  readonly timestamp: number | undefined;
}

export interface RawStopDelay {
  readonly stopSequence: number | undefined;
  readonly stopId: string | undefined;
  /** Seconds; positive is late. */
  readonly arrivalDelay: number | undefined;
  readonly departureDelay: number | undefined;
}

export interface RawTripUpdate {
  readonly tripId: string;
  readonly vehicleId: string | undefined;
  /** Trip-level delay, if given. */
  readonly delay: number | undefined;
  readonly stops: ReadonlyArray<RawStopDelay>;
  readonly timestamp: number | undefined;
}

export interface RawFeed<A> {
  /** Epoch seconds the producer stamped the feed with. */
  readonly timestamp: number | undefined;
  readonly entities: ReadonlyArray<A>;
}

const statuses: Record<number, VehicleStopStatus> = {
  [VehiclePosition_VehicleStopStatus.INCOMING_AT]: "incoming",
  [VehiclePosition_VehicleStopStatus.STOPPED_AT]: "stopped",
  [VehiclePosition_VehicleStopStatus.IN_TRANSIT_TO]: "in_transit",
};

const nonEmpty = (text: string) => (text === "" ? undefined : text);
const seconds = (value: bigint) => (value === 0n ? undefined : Number(value));

export const decodeVehiclePositions = (bytes: Uint8Array): RawFeed<RawVehicle> => {
  const feed = fromBinary(FeedMessageSchema, bytes);
  const entities: Array<RawVehicle> = [];
  for (const entity of feed.entity) {
    const vehicle = entity.vehicle;
    const position = vehicle?.position;
    if (vehicle === undefined || position === undefined || entity.isDeleted) continue;
    if (position.latitude === 0 && position.longitude === 0) continue;
    const set = (field: keyof typeof VehiclePositionSchema.field) =>
      isFieldSet(vehicle, VehiclePositionSchema.field[field]);
    entities.push({
      id: nonEmpty(vehicle.vehicle?.id ?? "") ?? entity.id,
      label: nonEmpty(vehicle.vehicle?.label ?? ""),
      tripId: nonEmpty(vehicle.trip?.tripId ?? ""),
      routeId: nonEmpty(vehicle.trip?.routeId ?? ""),
      lat: position.latitude,
      lon: position.longitude,
      bearing: isFieldSet(position, PositionSchema.field.bearing) ? position.bearing : undefined,
      speed: isFieldSet(position, PositionSchema.field.speed) ? position.speed : undefined,
      stopId: nonEmpty(vehicle.stopId),
      stopSequence: set("currentStopSequence") ? vehicle.currentStopSequence : undefined,
      status: set("currentStatus") ? statuses[vehicle.currentStatus] : undefined,
      timestamp: seconds(vehicle.timestamp),
    });
  }
  return { timestamp: seconds(feed.header?.timestamp ?? 0n), entities };
};

export const decodeTripUpdates = (bytes: Uint8Array): RawFeed<RawTripUpdate> => {
  const feed = fromBinary(FeedMessageSchema, bytes);
  const entities: Array<RawTripUpdate> = [];
  for (const entity of feed.entity) {
    const update = entity.tripUpdate;
    const tripId = nonEmpty(update?.trip?.tripId ?? "");
    if (update === undefined || tripId === undefined || entity.isDeleted) continue;
    const delayOf = (event: (typeof update.stopTimeUpdate)[number]["arrival"]) =>
      event !== undefined && isFieldSet(event, TripUpdate_StopTimeEventSchema.field.delay)
        ? event.delay
        : undefined;
    entities.push({
      tripId,
      vehicleId: nonEmpty(update.vehicle?.id ?? ""),
      delay: update.delay === 0 ? undefined : update.delay,
      stops: update.stopTimeUpdate.map((stop) => ({
        stopSequence: isFieldSet(stop, TripUpdate_StopTimeUpdateSchema.field.stopSequence)
          ? stop.stopSequence
          : undefined,
        stopId: nonEmpty(stop.stopId),
        arrivalDelay: delayOf(stop.arrival),
        departureDelay: delayOf(stop.departure),
      })),
      timestamp: seconds(update.timestamp),
    });
  }
  return { timestamp: seconds(feed.header?.timestamp ?? 0n), entities };
};
