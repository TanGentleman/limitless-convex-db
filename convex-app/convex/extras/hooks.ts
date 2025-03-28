"use node";
import { IncomingWebhook } from '@slack/webhook';

import { action, internalAction } from "../_generated/server";
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { formatDate } from './utils';

export const sendSlackNotification = internalAction({
  args: {
    blocks: v.optional(v.array(v.any())),
    operation: v.optional(v.union(v.literal("sync"), v.literal("create"), v.literal("read"), v.literal("update"), v.literal("delete")))
  },
  handler: async (ctx, args) => {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) {
      throw new Error('SLACK_WEBHOOK_URL is not set');
    }
    const webhook = new IncomingWebhook(url);
    
    // If custom blocks are provided, use them directly
    if (args.blocks) {
      await webhook.send({ blocks: args.blocks });
      return;
    }
    
    // Otherwise, generate blocks from operation logs
    const operation = args.operation || "sync";
    const [operationLog] = await ctx.runQuery(internal.extras.tests.getLogsByOperation, { operation, limit: 1 });
    
    if (!operationLog) {
      throw new Error(`No logs found for operation: ${operation}`);
    }
    
    const timestamp = formatDate(new Date(operationLog._creationTime));
    const status = operationLog.success ? "✅ Success" : "❌ Failure";
    const details = operationLog.data.error || operationLog.data.message || "No details available";
    
    await webhook.send({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*📊 Last Operation Report*\n` +
                  `*Operation:* ${operationLog.operation}\n` +
                  `*Status:* ${status}\n` +
                  `*Timestamp:* ${timestamp}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Details:*\n${details}`
          }
        }
      ]
    });
  },
});

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
      const webhook = new IncomingWebhook(url);
      
      // Format the markdown content for better readability
      const markdown = lastLifelog[0].markdown || "No content available";
      const timestamp = formatDate(new Date(lastLifelog[0]._creationTime));
      const title = lastLifelog[0].title || "Untitled Lifelog";
      
      // Process markdown to make it more Slack-friendly
      // Replace markdown headers with bold text
      const processedMarkdown = markdown
        .replace(/^# (.*$)/gm, '*$1*')
        .replace(/^## (.*$)/gm, '*$1*')
        .replace(/^### (.*$)/gm, '*$1*')
        // Add extra line breaks for better readability
        .replace(/\n- /g, '\n• ');
      
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
              text: processedMarkdown
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
    await ctx.runAction(internal.sync.syncLimitless);
    if (args.sendNotification === true) {
      await ctx.runAction(internal.extras.hooks.sendSlackNotification, {
        operation: "sync",
      });
    }
  },
});
