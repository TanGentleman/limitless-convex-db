import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";

export const scheduleSync = action({
    args: {
      seconds: v.optional(v.number()),
      minutes: v.optional(v.number()),
      hours: v.optional(v.number()),
      days: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
      const { seconds, minutes, hours, days } = args;
      // Check if there's already a scheduled sync
      const delay = (seconds || 0) * 1000 + (minutes || 0) * 60 * 1000 + (hours || 0) * 60 * 60 * 1000 + (days || 0) * 24 * 60 * 60 * 1000;
      const isScheduled = await ctx.runQuery(internal.extras.schedules.isSyncScheduled, {
        delay,
      });
      if (isScheduled) {
        console.log("Already scheduled.");
        return;
      }
      await ctx.scheduler.runAfter(delay, internal.sync.syncLimitless);
      await ctx.scheduler.runAfter(delay, internal.extras.hooks.sendSlackNotification, {
        operation: "sync",
      });
    },
  });

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