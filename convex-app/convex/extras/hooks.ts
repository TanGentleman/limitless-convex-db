'use node';

import { IncomingWebhook } from '@slack/webhook';
import { action, internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { formatDate, formatMarkdown } from './utils';
import { SlackBlockHelpers, SlackMessageBuilder } from './slackBlockHelpers';

// ================================================================================
// SIMPLIFIED TYPE DEFINITIONS
// ================================================================================

/**
 * Webhook providers
 */
export type WebhookProvider = 'slack' | 'discord';

/**
 * Notification severity levels
 */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * Webhook notification result
 */
export interface WebhookResult {
  success: boolean;
  message: string;
  errors?: string[];
  providers: WebhookProvider[];
}

/**
 * Simple notification data structure
 */
export interface NotificationData {
  title: string;
  message: string;
  severity?: NotificationSeverity;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: Date;
}

// ================================================================================
// SIMPLIFIED WEBHOOK MANAGER
// ================================================================================

class WebhookManager {
  private async sendToSlack(data: NotificationData): Promise<void> {
    const webhook = new IncomingWebhook(process.env.SLACK_WEBHOOK_URL!);
    const isTruncated = data.message.length > 2000;
    
    console.log('Sending to Slack:', {
      title: data.title,
      messageLength: data.message.length,
      isTruncated,
      hasFields: !!(data.fields && data.fields.length > 0)
    });
    
    // For simple messages, use a simpler format
    if (!data.fields || data.fields.length === 0) {
      // Don't remove title for simple messages since they don't have embedded titles
      const message = formatMarkdown(data.message, false, 2000);
      
      const blocks: any[] = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${data.title}*\n${message}`
          }
        }
      ];
      
      // Add truncation notice if needed
      if (isTruncated) {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '⚠️ _Message truncated due to length limits_'
            }
          ]
        });
      }
      
      console.log('Slack blocks (simple):', JSON.stringify(blocks, null, 2));
      await webhook.send({ blocks });
    } else {
      // For complex messages (like lifelogs), remove title since it's embedded in markdown
      const message = formatMarkdown(data.message, true, 2000);
      
      // Use SlackMessageBuilder for complex messages with fields
      const blocks = SlackMessageBuilder.statusUpdate(
        data.title,
        data.severity || 'info',
        message,
        data.fields?.map(f => ({ name: f.name, value: f.value }))
      );
      
      // Add truncation notice if needed
      if (isTruncated) {
        blocks.push(SlackBlockHelpers.context([
          SlackBlockHelpers.contextMarkdown('⚠️ _Message truncated due to length limits_')
        ]));
      }
      
      console.log('Slack blocks (complex):', JSON.stringify(blocks, null, 2));
      await webhook.send({ blocks });
    }
    
    console.log('Slack notification sent successfully');
  }

  private async sendToDiscord(data: NotificationData): Promise<void> {
    const colorMap = {
      info: 0x3498db,
      success: 0x2ecc71,
      warning: 0xf39c12,
      error: 0xe74c3c
    };

    // Discord embed limits
    const MAX_DESCRIPTION = 4096;
    const MAX_FIELD_VALUE = 1024;
    const MAX_TITLE = 256;

    console.log('Sending to Discord:', {
      title: data.title,
      messageLength: data.message.length,
      severity: data.severity || 'info'
    });

    // Truncate description if needed
    let description = data.message;
    let descriptionTruncated = false;
    if (description.length > MAX_DESCRIPTION) {
      description = description.substring(0, MAX_DESCRIPTION - 3) + '...';
      descriptionTruncated = true;
    }

    // Truncate title if needed
    let title = data.title;
    if (title.length > MAX_TITLE) {
      title = title.substring(0, MAX_TITLE - 3) + '...';
    }

    // Process fields with truncation
    const fields = data.fields?.map(f => {
      let value = f.value;
      if (value.length > MAX_FIELD_VALUE) {
        value = value.substring(0, MAX_FIELD_VALUE - 3) + '...';
      }
      return {
        name: f.name,
        value: value,
        inline: f.inline || false
      };
    });

    // Define Discord embed structure
    interface DiscordEmbed {
      title?: string;
      description?: string;
      color?: number;
      fields?: Array<{ name: string; value: string; inline?: boolean }>;
      timestamp?: string;
      footer?: { text: string };
    }

    // Create the embed object with proper structure
    const embed: DiscordEmbed = {
      title: title,
      description: description,
      color: colorMap[data.severity || 'info'],
      fields: fields || [],
      timestamp: (data.timestamp || new Date()).toISOString()
    };

    // Add footer if content was truncated
    if (descriptionTruncated) {
      embed.footer = {
        text: '⚠️ Message truncated due to length limits'
      };
    }

    console.log('Discord embed:', JSON.stringify(embed, null, 2));

    const response = await fetch(process.env.DISCORD_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Discord webhook failed:', response.status, errorText);
      throw new Error(`Discord webhook failed: ${response.status}`);
    }
    
    console.log('Discord notification sent successfully');
  }

  // Add new method for sending raw Slack blocks
  async sendRawSlackBlocks(blocks: SlackBlock[]): Promise<WebhookResult> {
    if (!process.env.SLACK_WEBHOOK_URL) {
      return {
        success: false,
        message: 'Slack webhook URL not configured',
        errors: ['Missing SLACK_WEBHOOK_URL environment variable'],
        providers: []
      };
    }

    const webhook = new IncomingWebhook(process.env.SLACK_WEBHOOK_URL);
    
    try {
      console.log('Sending raw Slack blocks:', JSON.stringify(blocks, null, 2));
      await webhook.send({ blocks });
      console.log('Raw Slack notification sent successfully');
      return {
        success: true,
        message: 'Slack notification sent',
        providers: ['slack']
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Raw Slack notification failed:', errorMsg);
      return {
        success: false,
        message: `Slack notification failed: ${errorMsg}`,
        errors: [errorMsg],
        providers: ['slack']
      };
    }
  }

  async sendNotification(
    data: NotificationData,
    providers?: WebhookProvider[]
  ): Promise<WebhookResult> {
    const availableProviders: WebhookProvider[] = [];
    if (process.env.SLACK_WEBHOOK_URL) availableProviders.push('slack');
    if (process.env.DISCORD_WEBHOOK_URL) availableProviders.push('discord');

    const targetProviders = providers || availableProviders;
    const errors: string[] = [];
    const successfulProviders: WebhookProvider[] = [];

    console.log('Sending notification:', {
      title: data.title,
      targetProviders,
      availableProviders
    });

    for (const provider of targetProviders) {
      try {
        if (provider === 'slack' && process.env.SLACK_WEBHOOK_URL) {
          await this.sendToSlack(data);
          successfulProviders.push(provider);
        } else if (provider === 'discord' && process.env.DISCORD_WEBHOOK_URL) {
          await this.sendToDiscord(data);
          successfulProviders.push(provider);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`${provider} webhook failed:`, errorMsg);
        errors.push(`${provider}: ${errorMsg}`);
      }
    }

    const result = {
      success: successfulProviders.length > 0,
      message: successfulProviders.length > 0 
        ? `Sent to ${successfulProviders.join(', ')}` 
        : `All providers failed`,
      errors: errors.length > 0 ? errors : undefined,
      providers: successfulProviders
    };

    console.log('Notification result:', result);
    return result;
  }
}

const webhookManager = new WebhookManager();

// ================================================================================
// TYPE DEFINITIONS FOR SLACK BLOCK KIT
// ================================================================================

/**
 * Type definitions for Slack Block Kit
 * Simplified version of actual Slack types
 */
export type SlackBlock = 
  | { type: 'section'; text?: SlackText; fields?: SlackText[]; accessory?: any }
  | { type: 'divider' }
  | { type: 'image'; image_url: string; alt_text: string }
  | { type: 'actions'; elements: any[] }
  | { type: 'context'; elements: SlackText[] }
  | { type: 'header'; text: SlackText };

export type SlackText = {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
};

// ================================================================================
// SIMPLIFIED PUBLIC API
// ================================================================================

/**
 * Send a simple notification to webhooks
 * @param title - Notification title
 * @param message - Notification message
 * @param severity - Notification severity level
 * @param fields - Optional additional fields
 * @param providers - Target providers (defaults to all configured)
 * @returns Promise<WebhookResult>
 */
export const sendNotification = internalAction({
  args: {
    title: v.string(),
    message: v.string(),
    severity: v.optional(v.union(
      v.literal('info'),
      v.literal('success'),
      v.literal('warning'),
      v.literal('error')
    )),
    fields: v.optional(v.array(v.object({
      name: v.string(),
      value: v.string(),
      inline: v.optional(v.boolean())
    }))),
    providers: v.optional(v.array(v.union(
      v.literal('slack'),
      v.literal('discord')
    )))
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    return await webhookManager.sendNotification({
      title: args.title,
      message: args.message,
      severity: args.severity,
      fields: args.fields,
      timestamp: new Date()
    }, args.providers);
  }
});

/**
 * Send a lifelog notification with smart content handling
 */
export const sendLifelogNotification = internalAction({
  args: {
    lifelogId: v.id('lifelogs'),
    providers: v.optional(v.array(v.union(v.literal('slack'), v.literal('discord'))))
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    const lifelogs = await ctx.runQuery(internal.lifelogs.getDocsById, {
      ids: [args.lifelogId]
    });
    
    if (lifelogs.length === 0) {
      throw new Error(`Lifelog not found: ${args.lifelogId}`);
    }

    const lifelog = lifelogs[0];
    const duration = Math.round((lifelog.endTime - lifelog.startTime) / 1000 / 60);
    
    // Create a preview of the markdown content
    const markdown = lifelog.markdown || 'No content available';
    const previewLength = 500; // Shorter preview for notifications
    // const preview = markdown.length > previewLength 
    //   ? markdown.substring(0, previewLength) + '...'
    //   : markdown;
    
    // Format the preview to remove excessive markdown formatting
    const cleanPreview = formatMarkdown(markdown, true, previewLength);
    
    return await ctx.runAction(internal.extras.hooks.sendNotification, {
      title: '📝 New Lifelog Entry',
      message: cleanPreview,
      severity: 'info',
      fields: [
        { name: 'Title', value: lifelog.title || 'Untitled Entry', inline: false },
        { name: 'Duration', value: `${duration} minutes`, inline: true },
        { name: 'Created', value: formatDate(new Date(lifelog.startTime)), inline: true },
        { name: 'Word Count', value: `~${Math.round(markdown.length / 5)} words`, inline: true }
      ],
      providers: args.providers
    });
  }
});

/**
 * Send an admin notification
 */
export const sendAdminNotification = internalAction({
  args: {
    adminValidator: v.string(),
    message: v.string(),
    severity: v.optional(v.union(
      v.literal('info'),
      v.literal('success'),
      v.literal('warning'),
      v.literal('error')
    ))
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    if (args.adminValidator !== process.env.ADMIN_PW) {
      return {
        success: false,
        message: 'Invalid admin password',
        errors: ['Authentication failed'],
        providers: []
      };
    }

    return await ctx.runAction(internal.extras.hooks.sendNotification, {
      title: '🔧 Admin Notification',
      message: args.message,
      severity: args.severity || 'info'
    });
  }
});

// ================================================================================
// PUBLIC ACTIONS
// ================================================================================

/**
 * Public action to send notifications (for external use)
 */
export const publicNotification = action({
  args: {
    title: v.string(),
    message: v.string(),
    severity: v.optional(v.union(
      v.literal('info'),
      v.literal('success'),
      v.literal('warning'),
      v.literal('error')
    ))
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    return await ctx.runAction(internal.extras.hooks.sendNotification, {
      title: args.title,
      message: args.message,
      severity: args.severity
    });
  }
});

/**
 * Public admin notification
 */
export const publicAdminNotification = action({
  args: {
    message: v.string(),
    severity: v.optional(v.union(
      v.literal('info'),
      v.literal('success'),
      v.literal('warning'),
      v.literal('error')
    ))
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    return await ctx.runAction(internal.extras.hooks.sendAdminNotification, {
      adminValidator: process.env.ADMIN_PW!,
      message: args.message,
      severity: args.severity
    });
  }
});

/**
 * Public action to send raw Slack Block Kit notifications
 * 
 * This action allows external callers to send properly formatted Slack Block Kit messages.
 * The blocks must conform to Slack's Block Kit specification.
 * 
 * @param blocks - Array of Slack Block Kit blocks (section, divider, context, etc.)
 * @returns Promise<WebhookResult> - Result indicating success/failure and which providers were used
 * 
 * @example
 * ```typescript
 * await ctx.runAction(api.extras.hooks.publicSlackNotification, {
 *   blocks: [
 *     {
 *       type: "section",
 *       text: {
 *         type: "mrkdwn",
 *         text: "*Hello World*\nThis is a test message"
 *       }
 *     }
 *   ]
 * });
 * ```
 */
export const publicSlackNotification = action({
  args: {
    blocks: v.array(v.any()) // Use v.any() since SlackBlock has complex union types
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    // Cast to SlackBlock[] since we can't properly validate the complex union type at runtime
    const blocks = args.blocks as SlackBlock[];
    return await webhookManager.sendRawSlackBlocks(blocks);
  }
});

// ================================================================================
// CONVENIENCE HELPERS
// ================================================================================

/**
 * Quick success notification
 */
export const notifySuccess = (title: string, message: string) => 
  ({ title, message, severity: 'success' as const });

/**
 * Quick error notification
 */
export const notifyError = (title: string, message: string) => 
  ({ title, message, severity: 'error' as const });

/**
 * Quick info notification
 */
export const notifyInfo = (title: string, message: string) => 
  ({ title, message, severity: 'info' as const });

/**
 * Quick warning notification
 */
export const notifyWarning = (title: string, message: string) => 
  ({ title, message, severity: 'warning' as const });

/**
 * Send an operation notification based on actual operation logs
 * Fetches the most recent operation log and reports its status
 */
export const sendOperationNotification = internalAction({
  args: {
    operation: v.union(
      v.literal('sync'),
      v.literal('create'),
      v.literal('read'),
      v.literal('update'),
      v.literal('delete'),
    ),
    providers: v.optional(v.array(v.union(
      v.literal('slack'),
      v.literal('discord')
    ))),
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    // Fetch the most recent operation log
    const [operationLog] = await ctx.runQuery(
      internal.extras.tests.getLogsByOperation,
      { operation: args.operation, limit: 1 }
    );
    
    if (!operationLog) {
      return await ctx.runAction(internal.extras.hooks.sendNotification, {
        title: `❓ ${args.operation.charAt(0).toUpperCase() + args.operation.slice(1)} Operation`,
        message: `No recent ${args.operation} operation logs found`,
        severity: 'warning',
        providers: args.providers
      });
    }

    // Map operation types to emojis
    const operationEmojis = {
      sync: '🔄',
      create: '➕',
      read: '👀',
      update: '✏️',
      delete: '🗑️'
    };

    const success = operationLog.success;
    const timestamp = formatDate(new Date(operationLog._creationTime));
    const details = operationLog.data?.error || operationLog.data?.message || 'No details available';
    
    // Build notification with operation details
    return await ctx.runAction(internal.extras.hooks.sendNotification, {
      title: `${operationEmojis[args.operation]} ${args.operation.charAt(0).toUpperCase() + args.operation.slice(1)} Operation`,
      message: `Operation ${success ? 'completed successfully' : 'failed'}`,
      severity: success ? 'success' : 'error',
      fields: [
        { name: 'Status', value: success ? '✅ Success' : '❌ Failure', inline: true },
        { name: 'Timestamp', value: timestamp, inline: true },
        { name: 'Table', value: operationLog.table || 'Unknown', inline: true },
        { name: 'Details', value: details, inline: false }
      ],
      providers: args.providers
    });
  }
});