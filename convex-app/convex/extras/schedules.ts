import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

// internal mutation  
export const isSyncScheduled = internalQuery({
  args: {
    delay: v.number(),
  },
  handler: async (ctx, args) => {
    const { delay } = args;
    const scheduledFunctions = await ctx.db.system.query("_scheduled_functions")
    .filter(q => q.eq(q.field("name"), "sync.js:syncLimitless")).order("desc")
    .take(1);
    if (scheduledFunctions.length === 0) {
      return false;
    }
    const scheduledFunction = scheduledFunctions[0];
    
    // Check if the function is already scheduled within 10 seconds of requested time
    const currentTime = Date.now();
    const requestedTime = currentTime + delay;
    
    // Return true if within 10 second window, false otherwise
    return Math.abs(scheduledFunction.scheduledTime - requestedTime) <= 10000;
  },
});
  /**
 * Template code for using scheduler
 * 
 * export const sendExpiringMessage = mutation({
 *   args: { body: v.string(), author: v.string() },
 *   handler: async (ctx, args) => {
 *     const { body, author } = args;
 *     const id = await ctx.db.insert("messages", { body, author });
 *     await ctx.scheduler.runAfter(5000, internal.messages.destruct, {
 *       messageId: id,
 *     });
 *   },
 * });
 * export const destruct = internalMutation({
 *   args: {
 *     messageId: v.id("messages"),
 *   },
 *   handler: async (ctx, args) => {
 *     await ctx.db.delete(args.messageId);
 *   },
 * });
 */