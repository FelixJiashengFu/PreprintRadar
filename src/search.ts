import * as db from "./db.ts";
import { searchAll, type SearchParams } from "./engine.ts";
import { buildProfile } from "./recommend.ts";

export type { SearchParams } from "./engine.ts";

/** Search, keeping the results in the database so stars and thumbs work on them. */
export async function search(params: SearchParams) {
  const r = await searchAll(params, buildProfile());
  for (const x of r.results) db.upsertPaper(x.paper);
  return r;
}
