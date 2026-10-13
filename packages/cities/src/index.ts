import { Schema } from "effect";
import { plLodz } from "./entries/pl-lodz.ts";
import { Catalog } from "./schema.ts";

export * from "./schema.ts";

/** Catalog entries as data, in encoded form. Validate with {@link loadCatalog}. */
export const entries: ReadonlyArray<(typeof Catalog.Encoded)[number]> = [plLodz];

/** The validated catalog. Fails with a `SchemaError` describing every invalid field. */
export const loadCatalog = Schema.decodeEffect(Catalog, { errors: "all" })(entries);
