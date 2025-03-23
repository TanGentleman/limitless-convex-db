import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, } from "./_generated/server";
export const syncLifelogs = internalAction({
    args: {
        startTime: v.number(),
    },
    handler: async (ctx, args) => {
        // 1. Call internal.meta.read to get meta
        // 2. Fetch lifelogs from Limitless API
        // 3. Dedupe and (optional) embed markdowns (new table)
        // 4. Add deduped lifelogs to database
        // 5. Update meta
        // 6. Report operations to the operations table
    },
});
