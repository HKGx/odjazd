import type { Envelope, Reply, WorkerRequest, WorkerResponses } from "./protocol.ts";

/** Promise-per-request wrapper around the timetable worker. */
export const makeClient = (worker: Worker) => {
  let next = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  worker.addEventListener("message", (event: MessageEvent<Reply>) => {
    const reply = event.data;
    const waiter = pending.get(reply.id);
    if (waiter === undefined) return;
    pending.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.value);
    else waiter.reject(new Error(reply.error));
  });

  return <R extends WorkerRequest>(request: R): Promise<WorkerResponses[R["kind"]]> =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, request } satisfies Envelope);
    });
};

export type TimetableClient = ReturnType<typeof makeClient>;
