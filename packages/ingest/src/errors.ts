import { Schema } from "effect";

/** The archive or a CSV file in it could not be read. */
export class GtfsParseError extends Schema.TaggedError<GtfsParseError>()("GtfsParseError", {
  file: Schema.optionalKey(Schema.String),
  message: Schema.String,
}) {}

/** The feed is readable but unusable: missing files or columns, unmapped agencies, no service. */
export class GtfsValidationError extends Schema.TaggedError<GtfsValidationError>()(
  "GtfsValidationError",
  {
    file: Schema.optionalKey(Schema.String),
    message: Schema.String,
  },
) {}

export type IngestError = GtfsParseError | GtfsValidationError;

/**
 * A non-fatal problem, aggregated per kind: the offending rows are skipped (or
 * repaired) and the feed still compiles. `example` identifies one occurrence.
 */
export interface IngestWarning {
  readonly file: string;
  readonly code: string;
  readonly message: string;
  readonly count: number;
  readonly example: string;
}

export class Warnings {
  private readonly byKey = new Map<
    string,
    { -readonly [K in keyof IngestWarning]: IngestWarning[K] }
  >();

  add(file: string, code: string, message: string, example: string): void {
    const key = `${file}\u0000${code}`;
    const existing = this.byKey.get(key);
    if (existing === undefined) this.byKey.set(key, { file, code, message, count: 1, example });
    else existing.count++;
  }

  toArray(): ReadonlyArray<IngestWarning> {
    return [...this.byKey.values()];
  }
}
