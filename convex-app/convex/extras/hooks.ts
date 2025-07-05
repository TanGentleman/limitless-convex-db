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
    
    // Use SlackMessageBuilder for consistent formatting
    const blocks = SlackMessageBuilder.statusUpdate(
      data.title,
      data.severity || 'info',
      data.message,
      data.fields?.map(f => ({ name: f.name, value: f.value }))
    );
    
    await webhook.send({ blocks });
  }

  private async sendToDiscord(data: NotificationData): Promise<void> {
    const colorMap = {
      info: 0x3498db,
      success: 0x2ecc71,
      warning: 0xf39c12,
      error: 0xe74c3c
    };

    const embed = {
      title: data.title,
      description: data.message,
      color: colorMap[data.severity || 'info'],
      fields: data.fields?.map(f => ({
        name: f.name,
        value: f.value,
        inline: f.inline || false
      })),
      timestamp: (data.timestamp || new Date()).toISOString()
    };

    const response = await fetch(process.env.DISCORD_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
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
        errors.push(`${provider}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      success: successfulProviders.length > 0,
      message: successfulProviders.length > 0 
        ? `Sent to ${successfulProviders.join(', ')}` 
        : `All providers failed`,
      errors: errors.length > 0 ? errors : undefined,
      providers: successfulProviders
    };
  }
}

const webhookManager = new WebhookManager();

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
 * Send a lifelog notification
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
    
    return await ctx.runAction(internal.extras.hooks.sendNotification, {
      title: '📝 New Lifelog Entry',
      message: lifelog.title || 'Untitled Entry',
      severity: 'info',
      fields: [
        { name: 'Duration', value: `${duration} minutes`, inline: true },
        { name: 'Created', value: formatDate(new Date(lifelog.startTime)), inline: true }
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