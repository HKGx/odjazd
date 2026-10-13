/// <reference lib="webworker" />
// Worker side of the protocol. Import this module from a worker script.
import { makeHost, type Host } from "./host.ts";
import { loadCity } from "./loader.ts";
import type { Envelope, LoadResult, Reply, WorkerRequest } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

let host: Host | undefined;

const lastDate = (first: string, count: number) =>
  new Date(Date.parse(`${first}T00:00:00Z`) + (count - 1) * 86_400_000).toISOString().slice(0, 10);

const handle = async (request: WorkerRequest): Promise<unknown> => {
  switch (request.kind) {
    case "load": {
      const { manifest, timetable, source } = await loadCity(request.apiBase, request.city);
      host = makeHost(timetable);
      const result: LoadResult = {
        manifest,
        source,
        timeZone: timetable.timeZone,
        stats: {
          lines: timetable.lines.length,
          stops: timetable.stops.count,
          trips: timetable.trips.count,
        },
        firstDate: timetable.days.first,
        lastDate: lastDate(timetable.days.first, timetable.days.count),
      };
      return result;
    }
    case "compare":
      if (host === undefined) throw new Error("no timetable loaded");
      return host.compare(request);
    case "board":
      if (host === undefined) throw new Error("no timetable loaded");
      return host.board(request);
  }
};

self.addEventListener("message", (event: MessageEvent<Envelope>) => {
  const { id, request } = event.data;
  handle(request).then(
    (value) => self.postMessage({ id, ok: true, value } satisfies Reply),
    (error: unknown) =>
      self.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies Reply),
  );
});
