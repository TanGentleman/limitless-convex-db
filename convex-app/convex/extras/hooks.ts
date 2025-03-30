"use node";
import { IncomingWebhook } from '@slack/webhook';

import { internalAction } from "../_generated/server";
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { formatDate } from './utils';

export const getWebhook = () => {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    throw new Error('SLACK_WEBHOOK_URL is not set');
  }
  return new IncomingWebhook(url);
};

export const sendSlackNotification = internalAction({
  args: {
    blocks: v.optional(v.array(v.any())),
    operation: v.optional(v.union(v.literal("sync"), v.literal("create"), v.literal("read"), v.literal("update"), v.literal("delete")))
  },
  handler: async (ctx, args) => {
    const webhook = getWebhook();
    
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