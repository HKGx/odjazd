import type { RouteDraft } from "../../route-draft.ts";
import { navigate } from "../../route.ts";

/** A draft handed to the route editor, e.g. by "Save as route" on a planned trip. */
let handoff: RouteDraft | undefined;

/** The handed-over draft, once. Not reactive: the editor reads it when it opens. */
export const takeHandoff = () => {
  const draft = handoff;
  handoff = undefined;
  return draft;
};

export const editDraft = (draft: RouteDraft) => {
  handoff = draft;
  navigate({ page: "route", id: undefined });
};
