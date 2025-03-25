"use node";
import { IncomingWebhook } from '@slack/webhook';

import { internalAction } from "../_generated/server";

export const sendSlackNotification = internalAction({
  handler: async (ctx, args) => {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) {
      throw new Error('SLACK_WEBHOOK_URL is not set');
    }
    const webhook = new IncomingWebhook(url);
    await webhook.send({
      text: 'Beep boop!',
    });
  },
});