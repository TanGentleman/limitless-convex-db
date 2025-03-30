"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { getWebhook } from "../extras/hooks";
import { formatMarkdown, formatDate } from "../extras/utils";

export const getLastLifelog = action({
    args: {
      sendNotification: v.optional(v.boolean())
    },
    handler: async (ctx, args) => {
      const lastLifelog = await ctx.runQuery(internal.lifelogs.readDocs, {
        limit: 1,
        direction: "desc",
      });
      if (lastLifelog.length === 0) {
        throw new Error("No lifelogs found");
      }
      
      // Send Slack notification if requested
      if (args.sendNotification === true) {
        const url = process.env.SLACK_WEBHOOK_URL;
        if (!url) {
          throw new Error('SLACK_WEBHOOK_URL is not set');
        }
        const webhook = getWebhook();
        
        // Format the markdown content for better readability
        const markdown = lastLifelog[0].markdown || "No content available";
        const timestamp = formatDate(new Date(lastLifelog[0]._creationTime));
        const title = lastLifelog[0].title || "Untitled Lifelog";
        
        // Process markdown to make it more Slack-friendly
        // Replace markdown headers with bold text
        const processedMarkdown = formatMarkdown(markdown, true);
        const maxContentLength = 2000;
        const truncatedMarkdown = processedMarkdown.length > maxContentLength 
          ? processedMarkdown.substring(0, maxContentLength) + "..." 
          : processedMarkdown;
        
        await webhook.send({
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "📝 Latest Lifelog Entry",
                emoji: true
              }
            },
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
                  text: `*Title:*\n${title}`
                },
                {
                  type: "mrkdwn",
                  text: `*Created:*\n${timestamp}`
                }
              ]
            },
            {
              type: "divider"
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: truncatedMarkdown
              }
            }
          ]
        });
      }
      
      return lastLifelog[0];
    },
  });

  export const sync = action({
    args: {
      sendNotification: v.optional(v.boolean())
    },
    handler: async (ctx, args) => {
      const isNewLifelogs = await ctx.runAction(internal.sync.syncLimitless);
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