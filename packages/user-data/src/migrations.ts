import { defaultPreferences, userDataVersion } from "./schema.ts";

/*
 * Pure N → N+1 steps, applied on load and on import until the document is at
 * the current version. Index i upgrades version i to i + 1. Version 0 is the
 * pre-release shape (no document): nothing to carry over.
 */
const steps: ReadonlyArray<(doc: Record<string, unknown>) => Record<string, unknown>> = [
  () => ({ schemaVersion: 1, records: [], preferences: defaultPreferences, seeded: [] }),
];

/** Brings an unknown JSON document up to the current schema version. Throws on garbage. */
export const migrate = (input: unknown): unknown => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("expected a JSON object");
  }
  let doc = input as Record<string, unknown>;
  const version = typeof doc["schemaVersion"] === "number" ? doc["schemaVersion"] : 0;
  if (version > userDataVersion) {
    throw new Error(`made by a newer version of odjazd (format ${version})`);
  }
  for (let v = version; v < userDataVersion; v++) {
    const step = steps[v];
    if (step === undefined) throw new Error(`no migration from format ${v}`);
    doc = step(doc);
  }
  return doc;
};
