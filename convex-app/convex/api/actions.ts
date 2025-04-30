import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc } from "../_generated/dataModel";

// Define a type for the lifelog document
type Lifelog = Doc<"lifelogs">;

export const getLastLifelog = action({
    args: {
      sendNotification: v.optional(v.boolean())
    },
    handler: async (ctx, args): Promise<Lifelog> => {
      const lastLifelog: Lifelog[] = await ctx.runQuery(internal.lifelogs.readDocs, {
        limit: 1,
        direction: "desc",
      });
      if (lastLifelog.length === 0) {
        throw new Error("No lifelogs found");
      }
      
      // Send Slack notification if requested
      if (args.sendNotification === true) {
        await ctx.runAction(internal.extras.hooks.sendSlackNotification, {
          lifelogId: lastLifelog[0]._id
        });
      }
      
      return lastLifelog[0];
    },
  });

  export const sync = action({
    args: {
      sendNotification: v.optional(v.boolean())
    },
    handler: async (ctx, args): Promise<boolean> => {
      const isNewLifelogs: boolean = await ctx.runAction(internal.sync.syncLimitless);
      if (args.sendNotification === true) {
        await ctx.runAction(internal.extras.hooks.sendSlackNotification, {
          operation: "sync",
        });
        // In case we are getting slightly stale data, keep a short delay
        // await ctx.scheduler.runAfter(500, internal.extras.hooks.sendSlackNotification, {
        //   operation: "sync",
        // });
      }
      
      return isNewLifelogs;
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
      // Check if there's already a scheduled sync
      const delay = (seconds || 0) * 1000 + (minutes || 0) * 60 * 1000 + (hours || 0) * 60 * 60 * 1000 + (days || 0) * 24 * 60 * 60 * 1000;
      const isScheduled = await ctx.runQuery(internal.extras.schedules.isSyncScheduled, {
        delay,
      });
      if (isScheduled) {
        console.log("Already scheduled.");
        return;
      }
      await ctx.scheduler.runAfter(delay, internal.sync.internalSync, {
        sendNotification: true,
      });
    },
  });