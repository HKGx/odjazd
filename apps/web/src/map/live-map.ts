import type { Feature, FeatureCollection, Point as GeoPoint } from "geojson";
import type { Vehicle } from "@odjazd/api";
import type { LineRouteDto, StopsDto } from "@odjazd/worker";
import {
  AttributionControl,
  type GeoJSONSource,
  GeolocateControl,
  Map as MapLibre,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// Vite pre-bundles MapLibre, which breaks its `import.meta.url`-relative worker lookup.
setWorkerUrl(workerUrl);

/*
 * The map, imperatively: MapLibre owns its canvas and sources, the UI pushes
 * data in and gets taps out. Vehicles glide from their last drawn position to
 * each new fix over most of a poll interval, so 15 s updates read as motion.
 */

export interface LiveMapOptions {
  readonly container: HTMLElement;
  readonly center: { readonly lat: number; readonly lon: number };
  readonly dark: boolean;
  readonly onStop: (group: number) => void;
  readonly onVehicle: (id: string) => void;
  readonly onBackground: () => void;
  /** Long-press (touch) or right-click on the map. */
  readonly onPoint: (lat: number, lon: number) => void;
}

export interface UserLayers {
  readonly areas: ReadonlyArray<{
    readonly name: string;
    readonly center: { readonly lat: number; readonly lon: number };
    readonly radiusMeters: number;
  }>;
  readonly places: ReadonlyArray<{
    readonly name: string;
    readonly icon: string;
    readonly point: { readonly lat: number; readonly lon: number };
  }>;
}

export interface Pin {
  readonly lat: number;
  readonly lon: number;
  /** Draws the circle an area here would cover. */
  readonly radiusMeters?: number | undefined;
}

export interface JourneyShape {
  readonly legs: ReadonlyArray<{
    readonly kind: "walk" | "ride";
    readonly mode?: string | undefined;
    readonly path: ReadonlyArray<{ readonly lat: number; readonly lon: number }>;
  }>;
}

/** A circle as a 48-gon; fine at city scale. */
const circle = (lat: number, lon: number, radiusMeters: number) => {
  const dLat = radiusMeters / 111_320;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  const ring = Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
  });
  return { type: "Polygon" as const, coordinates: [ring] };
};

export interface Focus {
  /** Line to emphasize; other vehicles fade. */
  readonly line?: string | undefined;
  readonly vehicle?: string | undefined;
  readonly stop?: number | undefined;
}

const styleUrl = (dark: boolean) =>
  `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;

const glideMs = 12_000;
const frameMs = 80;

interface Track {
  vehicle: Vehicle;
  fromLon: number;
  fromLat: number;
  start: number;
}

type Point = Feature<GeoPoint, { readonly [key: string]: unknown; readonly dim?: boolean }>;

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#2a78d6";

/** A 40×40 arrowhead pointing up, drawn once; rotated per vehicle bearing. */
const arrowImage = (color: string) => {
  const size = 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(size / 2, 1);
    ctx.lineTo(size / 2 + 7, 10);
    ctx.lineTo(size / 2 - 7, 10);
    ctx.closePath();
    ctx.fill();
  }
  return ctx?.getImageData(0, 0, size, size);
};

export class LiveMap {
  private readonly map: MapLibre;
  private readonly tracks = new Map<string, Track>();
  private stops: StopsDto | undefined;
  private route: LineRouteDto | undefined;
  private direction = 0;
  private focus: Focus = {};
  private frame: number | undefined;
  private lastFrame = 0;
  private ready = false;
  private dark: boolean;
  private user: UserLayers = { areas: [], places: [] };
  private pin: Pin | undefined;
  private journey: JourneyShape | undefined;
  private bottomInset = 0;
  /** Last point we centered, until the user moves the map themselves. */
  private target: { lat: number; lon: number; zoom: number | undefined } | undefined;

  private readonly options: LiveMapOptions;

  constructor(options: LiveMapOptions) {
    this.options = options;
    this.dark = options.dark;
    this.map = new MapLibre({
      container: options.container,
      style: styleUrl(options.dark),
      center: [options.center.lon, options.center.lat],
      zoom: 12.5,
      attributionControl: false,
      maxPitch: 0,
      dragRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    this.map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    // Location stays on the device: it only moves the map.
    this.map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "bottom-right",
    );
    this.map.on("style.load", () => this.install());
    this.map.on("dragstart", () => (this.target = undefined));
    this.map.on("click", (event) => {
      const hits = this.map.queryRenderedFeatures(event.point, {
        layers: ["vehicles", "stops", "route-stops"].filter((id) => this.map.getLayer(id)),
      });
      const vehicle = hits.find((hit) => hit.layer.id === "vehicles");
      const stop = hits.find((hit) => hit.layer.id !== "vehicles");
      if (vehicle !== undefined) this.options.onVehicle(String(vehicle.properties["id"]));
      else if (stop !== undefined) this.options.onStop(Number(stop.properties["group"]));
      else this.options.onBackground();
    });
    this.map.on("contextmenu", (event) => {
      event.preventDefault();
      this.options.onPoint(event.lngLat.lat, event.lngLat.lng);
    });
    // Touch long-press; any movement or a second finger cancels it.
    let press: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      if (press !== undefined) clearTimeout(press);
      press = undefined;
    };
    this.map.on("touchstart", (event) => {
      cancel();
      if (event.originalEvent.touches.length !== 1) return;
      const { lat, lng } = event.lngLat;
      press = setTimeout(() => {
        press = undefined;
        this.options.onPoint(lat, lng);
      }, 550);
    });
    for (const type of ["touchend", "touchcancel", "touchmove", "movestart"] as const) {
      this.map.on(type, cancel);
    }
    for (const layer of ["vehicles", "stops", "route-stops"]) {
      this.map.on("mouseenter", layer, () => (this.map.getCanvas().style.cursor = "pointer"));
      this.map.on("mouseleave", layer, () => (this.map.getCanvas().style.cursor = ""));
    }
  }

  setDark(dark: boolean) {
    if (dark === this.dark) return;
    this.dark = dark;
    this.ready = false;
    this.map.setStyle(styleUrl(dark));
  }

  private install() {
    const map = this.map;
    const tram = cssVar("--tram");
    const bus = cssVar("--bus");
    const surface = cssVar("--surface-1");
    const accent = cssVar("--accent");
    const text = cssVar("--text-primary");
    const font = ["Noto Sans Bold"];

    const arrow = arrowImage(this.dark ? "#f0efec" : "#0b0b0b");
    if (arrow !== undefined && !map.hasImage("arrow"))
      map.addImage("arrow", arrow, { pixelRatio: 2 });

    map.addSource("user-areas", { type: "geojson", data: empty });
    map.addSource("user-places", { type: "geojson", data: empty });
    map.addSource("pin", { type: "geojson", data: empty });
    map.addSource("stops", { type: "geojson", data: empty });
    map.addSource("journey", { type: "geojson", data: empty });

    map.addLayer({
      id: "user-areas",
      type: "fill",
      source: "user-areas",
      paint: { "fill-color": accent, "fill-opacity": 0.08 },
    });
    map.addLayer({
      id: "user-area-outlines",
      type: "line",
      source: "user-areas",
      paint: {
        "line-color": accent,
        "line-width": ["case", ["get", "pin"], 2, 1],
        "line-dasharray": [2, 2],
        "line-opacity": 0.7,
      },
    });
    map.addLayer({
      id: "user-area-labels",
      type: "symbol",
      source: "user-areas",
      minzoom: 13,
      filter: ["!", ["get", "pin"]],
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "symbol-placement": "line",
        "text-optional": true,
      },
      paint: { "text-color": accent, "text-halo-color": surface, "text-halo-width": 1.5 },
    });
    map.addSource("route", { type: "geojson", data: empty });
    map.addSource("route-stops", { type: "geojson", data: empty });
    map.addSource("vehicles", { type: "geojson", data: empty });

    map.addLayer({
      id: "stops",
      type: "circle",
      source: "stops",
      minzoom: 13.5,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13.5, 2.5, 17, 6],
        "circle-color": surface,
        "circle-stroke-color": ["case", ["==", ["get", "modes"], 2], bus, tram],
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "stop-labels",
      type: "symbol",
      source: "stops",
      minzoom: 15.5,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": text, "text-halo-color": surface, "text-halo-width": 1.5 },
    });
    map.addLayer({
      id: "route",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": accent, "line-width": 4, "line-opacity": 0.85 },
    });
    map.addLayer({
      id: "journey-walk",
      type: "line",
      source: "journey",
      filter: ["==", ["get", "kind"], "walk"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": text,
        "line-width": 3,
        "line-dasharray": [0.5, 2],
        "line-opacity": 0.7,
      },
    });
    map.addLayer({
      id: "journey-ride",
      type: "line",
      source: "journey",
      filter: ["==", ["get", "kind"], "ride"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["case", ["==", ["get", "mode"], "tram"], tram, bus],
        "line-width": 6,
        "line-opacity": 0.9,
      },
    });
    map.addLayer({
      id: "journey-points",
      type: "circle",
      source: "journey",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": surface,
        "circle-stroke-color": text,
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "route-stops",
      type: "circle",
      source: "route-stops",
      paint: {
        "circle-radius": 4.5,
        "circle-color": surface,
        "circle-stroke-color": accent,
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "route-stop-labels",
      type: "symbol",
      source: "route-stops",
      minzoom: 13,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-offset": [0.9, 0],
        "text-anchor": "left",
        "text-optional": true,
      },
      paint: { "text-color": text, "text-halo-color": surface, "text-halo-width": 1.5 },
    });
    map.addLayer({
      id: "vehicle-arrows",
      type: "symbol",
      source: "vehicles",
      filter: [">=", ["get", "bearing"], 0],
      layout: {
        "icon-image": "arrow",
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: { "icon-opacity": ["case", ["get", "dim"], 0.2, 0.9] },
    });
    map.addLayer({
      id: "vehicles",
      type: "circle",
      source: "vehicles",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          11,
          ["case", ["get", "selected"], 10, 6],
          14,
          ["case", ["get", "selected"], 13, 10],
        ],
        "circle-color": ["case", ["==", ["get", "mode"], "tram"], tram, bus],
        "circle-stroke-color": ["case", ["get", "selected"], accent, surface],
        "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
        "circle-opacity": ["case", ["get", "dim"], 0.25, 1],
        "circle-stroke-opacity": ["case", ["get", "dim"], 0.25, 1],
      },
    });
    map.addLayer({
      id: "vehicle-labels",
      type: "symbol",
      source: "vehicles",
      minzoom: 12,
      layout: {
        "text-field": ["get", "label"],
        "text-font": font,
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 15, 11],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": "#ffffff", "text-opacity": ["case", ["get", "dim"], 0.3, 1] },
    });

    map.addLayer({
      id: "user-places",
      type: "symbol",
      source: "user-places",
      layout: {
        "text-field": ["concat", ["get", "icon"], " ", ["get", "name"]],
        "text-font": font,
        "text-size": 12,
        "text-anchor": "left",
        "text-offset": [-0.4, 0],
        "text-allow-overlap": true,
      },
      paint: { "text-color": accent, "text-halo-color": surface, "text-halo-width": 2 },
    });
    map.addLayer({
      id: "pin",
      type: "circle",
      source: "pin",
      paint: {
        "circle-radius": 8,
        "circle-color": accent,
        "circle-stroke-color": surface,
        "circle-stroke-width": 3,
      },
    });

    this.ready = true;
    this.drawJourney();
    this.drawUser();
    this.drawStops();
    this.drawRoute();
    this.drawVehicles(performance.now());
  }

  /** The user's saved areas and places (drawn under transit). */
  setUserLayers(user: UserLayers) {
    this.user = user;
    this.drawUser();
  }

  setPin(pin: Pin | undefined) {
    this.pin = pin;
    this.drawUser();
  }

  private drawUser() {
    if (!this.ready) return;
    const pin = this.pin;
    const areas = this.user.areas.map((area) => ({
      type: "Feature" as const,
      geometry: circle(area.center.lat, area.center.lon, area.radiusMeters),
      properties: { name: area.name, pin: false },
    }));
    if (pin?.radiusMeters !== undefined) {
      areas.push({
        type: "Feature",
        geometry: circle(pin.lat, pin.lon, pin.radiusMeters),
        properties: { name: "", pin: true },
      });
    }
    this.map
      .getSource<GeoJSONSource>("user-areas")
      ?.setData({ type: "FeatureCollection", features: areas });
    this.map.getSource<GeoJSONSource>("user-places")?.setData({
      type: "FeatureCollection",
      features: this.user.places.map((place) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [place.point.lon, place.point.lat] },
        properties: { name: place.name, icon: place.icon },
      })),
    });
    this.map.getSource<GeoJSONSource>("pin")?.setData({
      type: "FeatureCollection",
      features:
        pin === undefined
          ? []
          : [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [pin.lon, pin.lat] },
                properties: {},
              },
            ],
    });
  }

  /** A planned journey, drawn over the map; `undefined` clears it. */
  setJourney(journey: JourneyShape | undefined) {
    this.journey = journey;
    this.drawJourney();
  }

  private drawJourney() {
    if (!this.ready) return;
    const legs = this.journey?.legs ?? [];
    const lines = legs
      .filter((leg) => leg.path.length >= 2)
      .map((leg) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: leg.path.map((p) => [p.lon, p.lat]),
        },
        properties: { kind: leg.kind, mode: leg.mode ?? "" },
      }));
    // Ends of each ride: where to get on and off.
    const points = legs
      .filter((leg) => leg.kind === "ride")
      .flatMap((leg) => [leg.path[0], leg.path[leg.path.length - 1]])
      .filter((p) => p !== undefined)
      .map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
        properties: { kind: "stop" },
      }));
    this.map
      .getSource<GeoJSONSource>("journey")
      ?.setData({ type: "FeatureCollection", features: [...lines, ...points] });
  }

  setStops(stops: StopsDto) {
    this.stops = stops;
    this.drawStops();
  }

  private drawStops() {
    const source = this.ready ? this.map.getSource<GeoJSONSource>("stops") : undefined;
    const stops = this.stops;
    if (source === undefined || stops === undefined) return;
    const features: Array<Point> = stops.names.map((name, group) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [stops.lon[group] ?? 0, stops.lat[group] ?? 0] },
      properties: { group, name, modes: stops.modes[group] ?? 0 },
    }));
    source.setData({ type: "FeatureCollection", features });
  }

  setRoute(route: LineRouteDto | undefined, direction: number) {
    this.route = route;
    this.direction = direction;
    this.drawRoute();
  }

  private drawRoute() {
    if (!this.ready) return;
    const line = this.map.getSource<GeoJSONSource>("route");
    const points = this.map.getSource<GeoJSONSource>("route-stops");
    const stops = this.route?.directions[this.direction]?.stops ?? [];
    line?.setData({
      type: "FeatureCollection",
      features:
        stops.length < 2
          ? []
          : [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: stops.map((s) => [s.lon, s.lat]) },
                properties: {},
              },
            ],
    });
    points?.setData({
      type: "FeatureCollection",
      features: stops.map((stop) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
        properties: { group: stop.group, name: stop.name },
      })),
    });
    this.map.setLayoutProperty("stops", "visibility", stops.length > 0 ? "none" : "visible");
    this.map.setLayoutProperty("stop-labels", "visibility", stops.length > 0 ? "none" : "visible");
  }

  setVehicles(vehicles: ReadonlyArray<Vehicle>) {
    const now = performance.now();
    const seen = new Set<string>();
    for (const vehicle of vehicles) {
      seen.add(vehicle.id);
      const track = this.tracks.get(vehicle.id);
      if (track === undefined) {
        this.tracks.set(vehicle.id, {
          vehicle,
          fromLon: vehicle.lon,
          fromLat: vehicle.lat,
          start: now,
        });
        continue;
      }
      if (track.vehicle.lat === vehicle.lat && track.vehicle.lon === vehicle.lon) {
        track.vehicle = vehicle;
        continue;
      }
      const [lon, lat] = this.position(track, now);
      // A jump of more than ~1 km (new trip, GPS glitch) snaps instead of gliding.
      const far = Math.abs(lat - vehicle.lat) + Math.abs(lon - vehicle.lon) > 0.012;
      track.fromLon = far ? vehicle.lon : lon;
      track.fromLat = far ? vehicle.lat : lat;
      track.start = now;
      track.vehicle = vehicle;
    }
    for (const id of this.tracks.keys()) if (!seen.has(id)) this.tracks.delete(id);
    this.animate();
  }

  setFocus(focus: Focus) {
    this.focus = focus;
    this.drawVehicles(performance.now());
  }

  private position(track: Track, now: number): [number, number] {
    const t = Math.min(1, (now - track.start) / glideMs);
    const eased = t < 1 ? t * (2 - t) : 1;
    return [
      track.fromLon + (track.vehicle.lon - track.fromLon) * eased,
      track.fromLat + (track.vehicle.lat - track.fromLat) * eased,
    ];
  }

  private drawVehicles(now: number) {
    const source = this.ready ? this.map.getSource<GeoJSONSource>("vehicles") : undefined;
    if (source === undefined) return;
    const { line, vehicle: selected } = this.focus;
    const features: Array<Point> = [];
    for (const track of this.tracks.values()) {
      const v = track.vehicle;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: this.position(track, now) },
        properties: {
          id: v.id,
          label: v.lineLabel,
          mode: v.mode,
          bearing: v.bearing ?? -1,
          selected: v.id === selected,
          dim:
            (line !== undefined && v.line !== line) ||
            (selected !== undefined && v.id !== selected),
        },
      });
    }
    // Selected and emphasized vehicles draw on top.
    features.sort((a, b) => Number(a.properties.dim !== true) - Number(b.properties.dim !== true));
    source.setData({ type: "FeatureCollection", features });
  }

  private animate() {
    if (this.frame !== undefined) return;
    const step = (now: number) => {
      this.frame = undefined;
      if (now - this.lastFrame >= frameMs) {
        this.lastFrame = now;
        this.drawVehicles(now);
      }
      let moving = false;
      for (const track of this.tracks.values()) {
        if (now - track.start < glideMs) {
          moving = true;
          break;
        }
      }
      if (moving && document.visibilityState === "visible") {
        this.frame = requestAnimationFrame(step);
      }
    };
    this.frame = requestAnimationFrame(step);
  }

  /** Current drawn position of a vehicle, for following it. */
  vehiclePosition(id: string): [number, number] | undefined {
    const track = this.tracks.get(id);
    return track === undefined ? undefined : this.position(track, performance.now());
  }

  flyTo(lat: number, lon: number, zoom?: number) {
    this.target = { lat, lon, zoom };
    this.map.easeTo({
      center: [lon, lat],
      zoom: Math.max(this.map.getZoom(), zoom ?? 15),
      padding: { top: 0, left: 0, right: 0, bottom: this.bottomInset },
      duration: 600,
    });
  }

  /** Pan just enough to keep a point in view (doesn't fight a user who zoomed out). */
  keepInView(lat: number, lon: number) {
    const bounds = this.map.getBounds();
    const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.15;
    const padLon = (bounds.getEast() - bounds.getWest()) * 0.15;
    const inside =
      lat > bounds.getSouth() + padLat &&
      lat < bounds.getNorth() - padLat &&
      lon > bounds.getWest() + padLon &&
      lon < bounds.getEast() - padLon;
    if (!inside) {
      this.map.easeTo({
        center: [lon, lat],
        padding: { top: 0, left: 0, right: 0, bottom: this.bottomInset },
        duration: 800,
      });
    }
  }

  fitPoints(
    points: ReadonlyArray<{ readonly lat: number; readonly lon: number }>,
    padding: number,
  ) {
    if (points.length === 0) return;
    let [west, south, east, north] = [180, 90, -180, -90];
    for (const p of points) {
      west = Math.min(west, p.lon);
      east = Math.max(east, p.lon);
      south = Math.min(south, p.lat);
      north = Math.max(north, p.lat);
    }
    this.map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        padding: {
          top: padding,
          left: padding,
          right: padding,
          bottom: padding + this.bottomInset,
        },
        duration: 600,
        maxZoom: 16,
      },
    );
  }

  /** Space covered by UI at the bottom (the mobile sheet); camera moves keep clear of it. */
  setBottomInset(pixels: number) {
    // Applied per camera move: `setPadding` would cancel a running animation.
    const moved = Math.abs(pixels - this.bottomInset) > 24;
    this.bottomInset = pixels;
    // The sheet grew after we centered something: center it again above the sheet.
    if (moved && this.target !== undefined) {
      this.flyTo(this.target.lat, this.target.lon, this.target.zoom);
    }
  }

  resize() {
    this.map.resize();
  }

  destroy() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.map.remove();
  }
}
