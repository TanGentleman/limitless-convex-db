import { action, internalAction } from "../_generated/server";
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
      const delay = (seconds || 0) * 1000 + (minutes || 0) * 60 * 1000 + (hours || 0) * 60 * 60 * 1000 + (days || 0) * 24 * 60 * 60 * 1000;
      await ctx.scheduler.runAfter(delay, api.extras.hooks.sync, {
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