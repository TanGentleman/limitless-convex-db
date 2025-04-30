import { internal } from "../_generated/api";
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { action } from "../_generated/server";

// Time window constants in milliseconds
const TIME_WINDOW_BUFFER = 15000; // 15 seconds buffer

export const isSyncScheduled = internalQuery({
  args: {
    targetTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const { targetTimestamp } = args;
    
    // Define time window for checking scheduled syncs
    const windowStart = targetTimestamp - TIME_WINDOW_BUFFER;
    const windowEnd = targetTimestamp + TIME_WINDOW_BUFFER;
    
    // Query for any scheduled sync within our time window
    const scheduledFunctions = await ctx.db.system
      .query("_scheduled_functions")
      .order("desc")
      .filter((q) => 
        q.or(
          // Check for pending syncs within our time window
          q.and(
            q.eq(q.field("completedTime"), undefined),
            q.eq(q.field("name"), "actions/sync.js:runSync"),
            q.gte(q.field("scheduledTime"), windowStart),
            q.lte(q.field("scheduledTime"), windowEnd)
          ),
          // Check for recently completed syncs
          q.and(
            q.neq(q.field("completedTime"), undefined),
            q.eq(q.field("name"), "actions/sync.js:runSync"),
            q.gte(q.field("completedTime"), targetTimestamp - TIME_WINDOW_BUFFER)
          )
        )
      )
      .take(1);

    return scheduledFunctions.length > 0;
  },
});

export const scheduleSync = action({
  args: {
    seconds: v.optional(v.number()),
    minutes: v.optional(v.number()),
    hours: v.optional(v.number()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { seconds, minutes, hours, days } = args;
    // Calculate total delay in milliseconds
    const delay =
      (seconds || 0) * 1000 +
      (minutes || 0) * 60 * 1000 +
      (hours || 0) * 60 * 60 * 1000 +
      (days || 0) * 24 * 60 * 60 * 1000;

    const currentTimestamp = Date.now();
    const targetTimestamp = currentTimestamp + delay;

    // Check if there's already a scheduled sync
    const isScheduled = await ctx.runQuery(internal.extras.schedules.isSyncScheduled, {
      targetTimestamp,
    });

    if (isScheduled) {
      console.log("Sync already scheduled for this time window.");
      return;
    }

    await ctx.scheduler.runAfter(delay, internal.actions.sync.runSync, {
      sendNotification: true,
    });
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
