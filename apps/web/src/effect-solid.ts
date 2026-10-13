import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect";
import { type Accessor, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { type AppServices, runtime } from "./runtime.ts";

/** An Effect failure surfaced to a Solid `<Errored>` boundary. */
export class EffectFailure extends Error {
  override readonly name = "EffectFailure";
  override readonly cause: Cause.Cause<unknown>;
  constructor(cause: Cause.Cause<unknown>) {
    super(describe(cause));
    this.cause = cause;
  }
}

const describe = (cause: Cause.Cause<unknown>): string => {
  const failure = Option.getOrUndefined(Cause.findErrorOption(cause));
  if (typeof failure === "object" && failure !== null && "message" in failure) {
    const message = (failure as { message: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return Cause.pretty(cause);
};

/**
 * Solid async memo backed by an Effect on the app runtime. `build` runs
 * tracked, so signals it reads become dependencies; the Effect it returns runs
 * untracked. A rerun (or disposal) interrupts the previous fiber. Reads of the
 * memo suspend inside `<Loading>` and failures reach `<Errored>`.
 */
export const createEffectMemo = <A, E>(build: () => Effect.Effect<A, E, AppServices>) =>
  createMemo(() => {
    const effect = build();
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    return runtime.runPromiseExit(effect, { signal: controller.signal }).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw new EffectFailure(exit.cause);
    });
  });

/** Fire-and-forget an Effect from an event handler. */
export const runFork = <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
  runtime.runFork(effect.pipe(Effect.tapCause((cause) => Effect.logError(cause))));

/**
 * A signal fed by an Effect stream on the app runtime. `build` runs tracked;
 * when its dependencies change (or the owner is disposed) the running stream
 * is interrupted and, if needed, a new one started. Stream failures are logged.
 */
export const createEffectStream = <A, E>(
  build: () => Stream.Stream<A, E, AppServices> | undefined,
  initial: A,
): Accessor<A> => {
  // Boxed: a function-valued A would otherwise read as a derived signal.
  const [box, setBox] = createSignal<{ readonly value: A }>({ value: initial });
  createEffect(
    () => build(),
    (stream) => {
      if (stream === undefined) return;
      const fiber = runFork(
        Stream.runForEach(stream, (a) => Effect.sync(() => setBox({ value: a }))),
      );
      return () => {
        runtime.runFork(Fiber.interrupt(fiber));
      };
    },
  );
  return () => box().value;
};
