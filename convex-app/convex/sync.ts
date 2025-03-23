import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, } from "./_generated/server";
export const syncLimitless = internalAction({
    args: {
        startTime: v.number(),
    },
    handler: async (ctx, args) => {
        // 1. Call internal.metadata.getLatest to get meta
        const meta = await ctx.runQuery(internal.metadata.getLatest);
        if (meta.length === 0) {
            console.log("No metadata found, creating default");
            const metaId = await ctx.runMutation(internal.metadata.createDefaultMeta);
            if (metaId === null) {
                console.log("Failed to create default metadata! Aborting sync.");
                return null;
            }
        }
        // 2. Fetch lifelogs from Limitless API
        
        // 3. Dedupe and (optional) embed markdowns (new table)
        // 4. Add deduped lifelogs to database
        // 5. Update meta
        // 6. Report operations to the operations table
    },
});
