import { query } from "$app/server";
import { z } from "zod";
import { requireUser } from "#lib/server/admin/access.js";
import { controller, unwrap } from "#lib/server/controller/index.js";
import { listOrgs } from "#lib/server/controller/generated/sdk.gen.js";

/** A page of the configured orgs' repositories: the same for every signed-in user. */
export const getOrgs = query(z.object({ after: z.string().max(200).optional(), limit: z.int().min(1).max(100).default(25) }), async ({ after, limit }) => {
  requireUser();
  return unwrap(await listOrgs({ client: controller(), query: after === undefined ? { limit } : { after, limit } }));
});
