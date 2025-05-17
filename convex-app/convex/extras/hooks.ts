"use node";
import { IncomingWebhook } from "@slack/webhook";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { formatDate, formatMarkdown } from "./utils";
import { Doc } from "../_generated/dataModel";

export const getWebhook = () => {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    throw new Error("SLACK_WEBHOOK_URL is not set");
  }
  return new IncomingWebhook(url);
};

// Define proper types for the content parameter
type LifelogContent = {
  type: "lifelog";
  data: Doc<"lifelogs">;
};

type OperationContent = {
  type: "operation";
  data: Doc<"operations">;
};

type SlackContent = LifelogContent | OperationContent;

// Helper function to generate Slack blocks for different content types
export const getSlackBlocks = (content: SlackContent) => {
  if (content.type === "lifelog") {
    const lifelog = content.data;
    const markdown = lifelog.markdown || "No content available";
    const timestamp = formatDate(new Date(lifelog.startTime));
    const title = lifelog.title || "Untitled Lifelog";

    // Process markdown to make it more Slack-friendly
    const processedMarkdown = formatMarkdown(markdown, true);
    const maxContentLength = 2000;
    const truncatedMarkdown =
      processedMarkdown.length > maxContentLength
        ? processedMarkdown.substring(0, maxContentLength) + "..."
        : processedMarkdown;

    return [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "📝 Latest Lifelog Entry",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Title:*\n${title}`,
          },
          {
            type: "mrkdwn",
            text: `*Created:*\n${timestamp}`,
          },
        ],
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncatedMarkdown,
        },
      },
    ];
  } else if (content.type === "operation") {
    const operationLog = content.data;
    const timestamp = formatDate(new Date(operationLog._creationTime));
    const status = operationLog.success ? "✅ Success" : "❌ Failure";
    const details =
      operationLog.data.error ||
      operationLog.data.message ||
      "No details available";

    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*📊 Last Operation Report*\n` +
            `*Operation:* ${operationLog.operation}\n` +
            `*Status:* ${status}\n` +
            `*Timestamp:* ${timestamp}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Details:*\n${details}`,
        },
      },
    ];
  }

  return [];
};

export const sendSlackNotification = internalAction({
  args: {
    blocks: v.optional(v.array(v.any())),
    operation: v.optional(
      v.union(
        v.literal("sync"),
        v.literal("create"),
        v.literal("read"),
        v.literal("update"),
        v.literal("delete"),
      ),
    ),
    lifelogId: v.optional(v.id("lifelogs")),
  },
  handler: async (ctx, args) => {
    const hasSlack = process.env.SLACK_WEBHOOK_URL !== undefined;
    if (!hasSlack) {
      console.error("SLACK_WEBHOOK_URL is not set");
      return;
    }

    const webhook = getWebhook();

    // If custom blocks are provided, use them directly
    if (args.blocks) {
      await webhook.send({ blocks: args.blocks });
      return;
    }

    // If a lifelog ID is provided, fetch and format that lifelog
    if (args.lifelogId) {
      const lifelog = await ctx.runQuery(internal.lifelogs.getDocsById, {
        ids: [args.lifelogId],
      });
      if (lifelog.length > 0) {
        const blocks = getSlackBlocks({
          type: "lifelog",
          data: lifelog[0],
        });
        await webhook.send({ blocks });
        return;
      }
    }

    // Otherwise, generate blocks from operation logs
    const operation = args.operation || "sync";
    const [operationLog] = await ctx.runQuery(
      internal.extras.tests.getLogsByOperation,
      { operation, limit: 1 },
    );

    if (!operationLog) {
      throw new Error(`No logs found for operation: ${operation}`);
    }

    const blocks = getSlackBlocks({
      type: "operation",
      data: operationLog,
    });
    await webhook.send({ blocks });
  },
});
