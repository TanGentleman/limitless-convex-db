// Patch operations

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";


// Update operation logs with a specific message format
export const patchOperations = internalMutation({
    args: {},
    handler: async (ctx) => {
      const recentLogs = await ctx.runQuery(internal.operations.readAll, { limit: 100 });
      for (const log of recentLogs) {
        if (log.data) {
          let message = '';
          
          // Only process logs with the specific fields
          if ('lifelogsAdded' in log.data && 'lifelogsProcessed' in log.data) {
            message = `Added ${log.data.lifelogsAdded} of ${log.data.lifelogsProcessed} processed lifelogs`;
          } 
          else if ('count' in log.data && 'reason' in log.data) {
            message = `Skipped ${log.data.count} lifelogs (reason: ${log.data.reason})`;
          }
          
          // Only patch if we have a message to update
          if (message) {
            await ctx.db.patch(log._id, {
              data: { message }
            });
          }
        }
      }
    },
  });