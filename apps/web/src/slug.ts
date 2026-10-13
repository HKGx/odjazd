/** URL-safe slug from a display name; `taken` slugs get a numeric suffix. */
export const slugify = (name: string, taken: ReadonlySet<string>): string => {
  const base =
    name
      .toLowerCase()
      .replaceAll("ł", "l")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "area";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
};
