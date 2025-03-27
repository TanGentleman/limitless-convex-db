"use node";
import { IncomingWebhook } from '@slack/webhook';

import { action, internalAction } from "../_generated/server";
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { formatDate } from './utils';

export const sendSlackNotification = internalAction({
  handler: async (ctx, args) => {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) {
      throw new Error('SLACK_WEBHOOK_URL is not set');
    }
    const webhook = new IncomingWebhook(url);
    const [operation] = await ctx.runQuery(internal.extras.tests.getLogsByOperation, { operation: "sync", limit: 1 });
    const timestamp = formatDate(new Date(operation._creationTime));
    const status = operation.success ? "✅ Success" : "❌ Failure";
    const details = operation.data.error || operation.data.message || "No details available";
    
    await webhook.send({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*📊 Last Operation Report*\n` +
                  `*Operation:* ${operation.operation}\n` +
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

export const sync = action({
  args: {
    sendNotification: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    await ctx.runAction(internal.sync.syncLimitless);
    if (args.sendNotification === true) {
      await ctx.runAction(internal.extras.hooks.sendSlackNotification, {});
    }
  },
});
