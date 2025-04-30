import { query } from "../_generated/server";

export const getPreviewLifelog = query({
  handler: async (ctx) => {
    const lastLifelog = await ctx.db.query("lifelogs").order("desc").take(1);
    if (lastLifelog.length === 0) {
      return null;
    }
    return lastLifelog[0];
  },
});
