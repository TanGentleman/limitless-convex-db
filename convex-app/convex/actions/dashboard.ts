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