import { parse } from "csv-parse/sync";
import { Effect } from "effect";
import { strFromU8, unzipSync } from "fflate";
import { GtfsParseError, GtfsValidationError } from "./errors.ts";

/** GTFS files by name (`stops.txt`), regardless of folders inside the archive. */
export type GtfsFiles = ReadonlyMap<string, Uint8Array>;

export const unzipGtfs = (zip: Uint8Array): Effect.Effect<GtfsFiles, GtfsParseError> =>
  Effect.try({
    try: () => {
      const files = new Map<string, Uint8Array>();
      for (const [path, bytes] of Object.entries(unzipSync(zip))) {
        const name = path.slice(path.lastIndexOf("/") + 1);
        if (name.endsWith(".txt")) files.set(name, bytes);
      }
      return files as GtfsFiles;
    },
    catch: (cause) => GtfsParseError.make({ message: `unreadable zip: ${String(cause)}` }),
  });

export interface Table {
  readonly file: string;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  /** Column index by header name, or -1 if the column is absent. */
  readonly column: (name: string) => number;
}

/** A cell, or `""` when the column is absent or the row is short. */
export const cell = (row: ReadonlyArray<string>, column: number): string =>
  column < 0 ? "" : (row[column] ?? "");

const parseTable = (file: string, bytes: Uint8Array): Effect.Effect<Table, GtfsParseError> =>
  Effect.try({
    try: (): Table => {
      const records: Array<Array<string>> = parse(strFromU8(bytes), {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
      });
      const header = (records.shift() ?? []).map((name) => name.trim());
      const columns = new Map(header.map((name, index) => [name, index]));
      return { file, rows: records, column: (name) => columns.get(name) ?? -1 };
    },
    catch: (cause) => GtfsParseError.make({ file, message: String(cause) }),
  });

/** A required file with its required columns. */
export const readTable = Effect.fn("readTable")(function* (
  files: GtfsFiles,
  file: string,
  requiredColumns: ReadonlyArray<string>,
) {
  const bytes = files.get(file);
  if (bytes === undefined) {
    return yield* GtfsValidationError.make({ file, message: "required file missing" });
  }
  const table = yield* parseTable(file, bytes);
  const missing = requiredColumns.filter((name) => table.column(name) < 0);
  if (missing.length > 0) {
    return yield* GtfsValidationError.make({
      file,
      message: `missing columns: ${missing.join(", ")}`,
    });
  }
  return table;
});

/** An optional file: `undefined` if absent. Present files must still parse. */
export const readOptionalTable = Effect.fn("readOptionalTable")(function* (
  files: GtfsFiles,
  file: string,
  requiredColumns: ReadonlyArray<string>,
) {
  if (!files.has(file)) return undefined;
  return yield* readTable(files, file, requiredColumns);
});
