import { Schema } from "effect";
import { plCzestochowa } from "./entries/pl-czestochowa.ts";
import { plGdansk } from "./entries/pl-gdansk.ts";
import { plGliwice } from "./entries/pl-gliwice.ts";
import { plGrodziskMazowiecki } from "./entries/pl-grodzisk-mazowiecki.ts";
import { plKielce } from "./entries/pl-kielce.ts";
import { plKrakow } from "./entries/pl-krakow.ts";
import { plKrosno } from "./entries/pl-krosno.ts";
import { plLodz } from "./entries/pl-lodz.ts";
import { plOlkusz } from "./entries/pl-olkusz.ts";
import { plPoznan } from "./entries/pl-poznan.ts";
import { plRzeszow } from "./entries/pl-rzeszow.ts";
import { plSiedlce } from "./entries/pl-siedlce.ts";
import { plSzczecin } from "./entries/pl-szczecin.ts";
import { plWarszawa } from "./entries/pl-warszawa.ts";
import { plWroclaw } from "./entries/pl-wroclaw.ts";
import { Catalog } from "./schema.ts";

export * from "./schema.ts";

/** Catalog entries as data, in encoded form. Validate with {@link loadCatalog}. */
export const entries: ReadonlyArray<(typeof Catalog.Encoded)[number]> = [
  plLodz,
  plGdansk,
  plGliwice,
  plPoznan,
  plWroclaw,
  plWarszawa,
  plKrakow,
  plSzczecin,
  plRzeszow,
  plKielce,
  plSiedlce,
  plKrosno,
  plGrodziskMazowiecki,
  plOlkusz,
  plCzestochowa,
];

/** The validated catalog. Fails with a `SchemaError` describing every invalid field. */
export const loadCatalog = Schema.decodeEffect(Catalog, { errors: "all" })(entries);
