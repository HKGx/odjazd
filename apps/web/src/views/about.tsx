import type { CitySummary } from "@odjazd/api";
import type { LoadResult } from "@odjazd/worker";
import { For, Show } from "solid-js";
import { megabytes } from "../format.ts";

export const AboutView = (props: { city: CitySummary; loaded: LoadResult }) => {
  const manifest = () => props.loaded.manifest;
  const compiled = () =>
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: props.loaded.timeZone,
    }).format(manifest().compiledAt * 1000);
  return (
    <section class="about">
      <div class="card">
        <h2>Timetable</h2>
        <dl class="facts">
          <dt>City</dt>
          <dd>{props.city.name["en"] ?? props.city.id}</dd>
          <dt>Feed version</dt>
          <dd>{manifest().timetable.feedVersion ?? "—"}</dd>
          <dt>Covers</dt>
          <dd>
            {props.loaded.firstDate} to {props.loaded.lastDate}
          </dd>
          <dt>Compiled</dt>
          <dd>{compiled()}</dd>
          <dt>Size</dt>
          <dd>
            {megabytes(manifest().timetable.compressedBytes ?? manifest().timetable.bytes)}{" "}
            download, {megabytes(manifest().timetable.bytes)} in memory
          </dd>
          <dt>Contents</dt>
          <dd>
            {props.loaded.stats.lines} lines, {props.loaded.stats.stops} stops,{" "}
            {props.loaded.stats.trips.toLocaleString("en-GB")} trips
          </dd>
          <dt>Source</dt>
          <dd>{props.loaded.source === "cache" ? "offline copy" : "network"}</dd>
          <dt>Walking</dt>
          <Show
            when={manifest().streets}
            fallback={<dd>Estimated: straight line × 1.3 (no street network for this city)</dd>}
          >
            {(streets) => (
              <dd>
                Along the streets (OpenStreetMap
                {streets().osmTimestamp === undefined
                  ? ""
                  : ` of ${streets().osmTimestamp?.slice(0, 10)}`}
                ), {megabytes(streets().compressedBytes ?? streets().bytes)} download
              </dd>
            )}
          </Show>
        </dl>
      </div>
      <div class="card">
        <h2>Data and licences</h2>
        <ul>
          <For each={manifest().attribution}>
            {(license) => (
              <li>
                {license.attribution} ·{" "}
                <a href={license.sourceUrl} rel="noopener" target="_blank">
                  source
                </a>{" "}
                ·{" "}
                <a href={license.url} rel="noopener license" target="_blank">
                  {license.spdx}
                </a>
              </li>
            )}
          </For>
        </ul>
        <p class="muted">
          Travel times and walks are computed on this device from the published schedule and street
          map. Your areas, corridors and location never leave it.
        </p>
      </div>
    </section>
  );
};
