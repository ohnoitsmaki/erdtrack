import { internalQuery, query } from "./_generated/server";
import { viewerRole } from "./channels";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const role = await viewerRole(ctx);
    if (role.status !== "owner" && role.status !== "mod") {
      return { status: role.status } as const;
    }
    return { status: role.status, displayName: role.displayName } as const;
  },
});

// The Panel's address, for the deploy to print. The Overlay is under it.
export const siteUrl = internalQuery({
  args: {},
  handler: async () => process.env.CONVEX_SITE_URL!,
});
