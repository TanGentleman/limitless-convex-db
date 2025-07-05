'use node';

import { IncomingWebhook } from '@slack/webhook';
import { action, internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { formatDate, formatMarkdown } from './utils';
import { Doc } from '../_generated/dataModel';

// ================================================================================
// CORE TYPES & INTERFACES
// ================================================================================

/**
 * Supported webhook providers
 */
export type WebhookProvider = 'slack' | 'discord' | 'custom';

/**
 * Content types that can be sent via webhooks
 */
export type WebhookContentType = 'lifelog' | 'operation' | 'alert' | 'summary' | 'custom';

/**
 * Severity levels for notifications
 */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * Base webhook payload structure
 */
interface WebhookPayload {
  provider: WebhookProvider;
  content: any; // Provider-specific format
  metadata?: {
    timestamp: number;
    severity: NotificationSeverity;
    source: string;
    [key: string]: any;
  };
}

/**
 * Generic content structure for different types
 */
interface WebhookContent<T = any> {
  type: WebhookContentType;
  data: T;
  title?: string;
  severity?: NotificationSeverity;
  context?: Record<string, any>;
}

// ================================================================================
// WEBHOOK PROVIDERS
// ================================================================================

/**
 * Abstract webhook provider interface
 */
abstract class BaseWebhookProvider {
  abstract name: WebhookProvider;
  abstract isConfigured(): boolean;
  abstract send(payload: WebhookPayload): Promise<void>;
}

/**
 * Slack webhook provider
 */
class SlackWebhookProvider extends BaseWebhookProvider {
  name: WebhookProvider = 'slack';
  
  isConfigured(): boolean {
    return process.env.SLACK_WEBHOOK_URL !== undefined;
  }
  
  private getWebhook(): IncomingWebhook {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) {
      throw new Error('SLACK_WEBHOOK_URL environment variable is not set');
    }
    return new IncomingWebhook(url);
  }
  
  async send(payload: WebhookPayload): Promise<void> {
    const webhook = this.getWebhook();
    await webhook.send({ 
      blocks: payload.content,
      text: payload.metadata?.fallbackText || 'New notification'
    });
  }
}

/**
 * Discord webhook provider
 */
class DiscordWebhookProvider extends BaseWebhookProvider {
  name: WebhookProvider = 'discord';
  
  isConfigured(): boolean {
    return process.env.DISCORD_WEBHOOK_URL !== undefined;
  }
  
  async send(payload: WebhookPayload): Promise<void> {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) {
      throw new Error('DISCORD_WEBHOOK_URL environment variable is not set');
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.content)
    });
    
    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
    }
  }
}

/**
 * Custom webhook provider for any HTTP endpoint
 */
class CustomWebhookProvider extends BaseWebhookProvider {
  name: WebhookProvider = 'custom';
  
  isConfigured(): boolean {
    return process.env.CUSTOM_WEBHOOK_URL !== undefined;
  }
  
  async send(payload: WebhookPayload): Promise<void> {
    const url = process.env.CUSTOM_WEBHOOK_URL;
    if (!url) {
      throw new Error('CUSTOM_WEBHOOK_URL environment variable is not set');
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Custom webhook failed: ${response.status}`);
    }
  }
}

// ================================================================================
// CONTENT FORMATTERS
// ================================================================================

/**
 * Abstract content formatter interface
 */
abstract class BaseContentFormatter<T> {
  abstract contentType: WebhookContentType;
  abstract format(content: WebhookContent<T>, provider: WebhookProvider): any;
}

/**
 * Lifelog content formatter
 */
class LifelogFormatter extends BaseContentFormatter<Doc<'lifelogs'>> {
  contentType: WebhookContentType = 'lifelog';
  
  format(content: WebhookContent<Doc<'lifelogs'>>, provider: WebhookProvider): any {
    const lifelog = content.data;
    const markdown = lifelog.markdown || 'No content available';
    const timestamp = formatDate(new Date(lifelog.startTime));
    const title = content.title || lifelog.title || 'Untitled Lifelog';
    
    switch (provider) {
      case 'slack':
        return this.formatForSlack(lifelog, title, timestamp, markdown);
      case 'discord':
        return this.formatForDiscord(lifelog, title, timestamp, markdown);
      default:
        return this.formatGeneric(lifelog, title, timestamp, markdown);
    }
  }
  
  private formatForSlack(lifelog: Doc<'lifelogs'>, title: string, timestamp: string, markdown: string) {
    const processedMarkdown = formatMarkdown(markdown, true);
    const maxContentLength = 2000;
    const truncatedMarkdown = processedMarkdown.length > maxContentLength
      ? processedMarkdown.substring(0, maxContentLength) + '...'
      : processedMarkdown;
    
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📝 Latest Lifelog Entry',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Title:*\n${title}`,
          },
          {
            type: 'mrkdwn',
            text: `*Created:*\n${timestamp}`,
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncatedMarkdown,
        },
      },
    ];
  }
  
  private formatForDiscord(lifelog: Doc<'lifelogs'>, title: string, timestamp: string, markdown: string) {
    const processedMarkdown = formatMarkdown(markdown, true);
    const maxContentLength = 2000;
    const truncatedMarkdown = processedMarkdown.length > maxContentLength
      ? processedMarkdown.substring(0, maxContentLength) + '...'
      : processedMarkdown;
    
    return {
      embeds: [{
        title: '📝 Latest Lifelog Entry',
        color: 0x5865F2, // Discord blue
        fields: [
          { name: 'Title', value: title, inline: true },
          { name: 'Created', value: timestamp, inline: true },
        ],
        description: truncatedMarkdown,
        timestamp: new Date(lifelog.startTime).toISOString(),
      }]
    };
  }
  
  private formatGeneric(lifelog: Doc<'lifelogs'>, title: string, timestamp: string, markdown: string) {
    return {
      type: 'lifelog',
      title,
      timestamp,
      content: markdown,
      metadata: {
        lifelogId: lifelog.lifelogId,
        startTime: lifelog.startTime,
        endTime: lifelog.endTime,
      }
    };
  }
}

/**
 * Operation content formatter
 */
class OperationFormatter extends BaseContentFormatter<Doc<'operations'>> {
  contentType: WebhookContentType = 'operation';
  
  format(content: WebhookContent<Doc<'operations'>>, provider: WebhookProvider): any {
    const operation = content.data;
    const timestamp = formatDate(new Date(operation._creationTime));
    const status = operation.success ? '✅ Success' : '❌ Failure';
    const details = operation.data?.error || operation.data?.message || 'No details available';
    
    switch (provider) {
      case 'slack':
        return this.formatForSlack(operation, timestamp, status, details);
      case 'discord':
        return this.formatForDiscord(operation, timestamp, status, details);
      default:
        return this.formatGeneric(operation, timestamp, status, details);
    }
  }
  
  private formatForSlack(operation: Doc<'operations'>, timestamp: string, status: string, details: string) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📊 Operation Report*\n*Operation:* ${operation.operation}\n*Status:* ${status}\n*Timestamp:* ${timestamp}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Details:*\n${details}`,
        },
      },
    ];
  }
  
  private formatForDiscord(operation: Doc<'operations'>, timestamp: string, status: string, details: string) {
    return {
      embeds: [{
        title: '📊 Operation Report',
        color: operation.success ? 0x00FF00 : 0xFF0000,
        fields: [
          { name: 'Operation', value: operation.operation, inline: true },
          { name: 'Status', value: status, inline: true },
          { name: 'Timestamp', value: timestamp, inline: true },
          { name: 'Details', value: details, inline: false },
        ],
        timestamp: new Date(operation._creationTime).toISOString(),
      }]
    };
  }
  
  private formatGeneric(operation: Doc<'operations'>, timestamp: string, status: string, details: string) {
    return {
      type: 'operation',
      operation: operation.operation,
      success: operation.success,
      timestamp,
      details,
      metadata: {
        table: operation.table,
        creationTime: operation._creationTime,
      }
    };
  }
}

// ================================================================================
// WEBHOOK MANAGER
// ================================================================================

/**
 * Central webhook manager that handles all providers and formatters
 */
class WebhookManager {
  private providers: Map<WebhookProvider, BaseWebhookProvider> = new Map();
  private formatters: Map<WebhookContentType, BaseContentFormatter<any>> = new Map();
  
  constructor() {
    this.initializeProviders();
    this.initializeFormatters();
  }
  
  private initializeProviders() {
    this.providers.set('slack', new SlackWebhookProvider());
    this.providers.set('discord', new DiscordWebhookProvider());
    this.providers.set('custom', new CustomWebhookProvider());
  }
  
  private initializeFormatters() {
    this.formatters.set('lifelog', new LifelogFormatter());
    this.formatters.set('operation', new OperationFormatter());
  }
  
  getAvailableProviders(): WebhookProvider[] {
    return Array.from(this.providers.keys()).filter(provider => 
      this.providers.get(provider)?.isConfigured()
    );
  }
  
  async sendNotification<T>(
    content: WebhookContent<T>,
    providers: WebhookProvider[] = this.getAvailableProviders()
  ): Promise<void> {
    const formatter = this.formatters.get(content.type);
    if (!formatter) {
      throw new Error(`No formatter found for content type: ${content.type}`);
    }
    
    const errors: string[] = [];
    
    for (const providerName of providers) {
      const provider = this.providers.get(providerName);
      if (!provider) {
        errors.push(`Provider ${providerName} not found`);
        continue;
      }
      
      if (!provider.isConfigured()) {
        errors.push(`Provider ${providerName} not configured`);
        continue;
      }
      
      try {
        const formattedContent = formatter.format(content, providerName);
        const payload: WebhookPayload = {
          provider: providerName,
          content: formattedContent,
          metadata: {
            timestamp: Date.now(),
            severity: content.severity || 'info',
            source: 'limitless-webhook-system',
            contentType: content.type,
            ...content.context
          }
        };
        
        await provider.send(payload);
        console.log(`Successfully sent notification to ${providerName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${providerName}: ${errorMessage}`);
        console.error(`Failed to send notification to ${providerName}:`, error);
      }
    }
    
    if (errors.length > 0 && errors.length === providers.length) {
      throw new Error(`All webhook providers failed: ${errors.join(', ')}`);
    }
  }
}

// ================================================================================
// MAIN WEBHOOK ACTION (GENERIC)
// ================================================================================

/**
 * Generic webhook action - the core of the new system
 */
export const sendWebhookNotification = internalAction({
  args: {
    contentType: v.union(
      v.literal('lifelog'),
      v.literal('operation'),
      v.literal('alert'),
      v.literal('summary'),
      v.literal('custom')
    ),
    data: v.any(),
    providers: v.optional(v.array(v.union(
      v.literal('slack'),
      v.literal('discord'),
      v.literal('custom')
    ))),
    title: v.optional(v.string()),
    severity: v.optional(v.union(
      v.literal('info'),
      v.literal('success'),
      v.literal('warning'),
      v.literal('error')
    )),
    context: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    const manager = new WebhookManager();
    
    const content: WebhookContent = {
      type: args.contentType,
      data: args.data,
      title: args.title,
      severity: args.severity,
      context: args.context,
    };
    
    await manager.sendNotification(content, args.providers);
  },
});

// ================================================================================
// CONVENIENCE WRAPPER FUNCTIONS
// ================================================================================

/**
 * Send lifelog notification (wrapper around generic function)
 */
export const sendLifelogNotification = internalAction({
  args: {
    lifelogId: v.id('lifelogs'),
    providers: v.optional(v.array(v.union(
      v.literal('slack'),
      v.literal('discord'),
      v.literal('custom')
    ))),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const lifelogs = await ctx.runQuery(internal.lifelogs.getDocsById, {
      ids: [args.lifelogId],
    });
    
    if (lifelogs.length === 0) {
      throw new Error(`Lifelog not found: ${args.lifelogId}`);
    }
    
    await ctx.runAction(internal.extras.hooks.sendWebhookNotification, {
      contentType: 'lifelog',
      data: lifelogs[0],
      providers: args.providers,
      title: args.title,
      severity: 'info',
    });
  },
});

/**
 * Send operation notification (wrapper around generic function)
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
      v.literal('discord'),
      v.literal('custom')
    ))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const [operationLog] = await ctx.runQuery(
      internal.extras.tests.getLogsByOperation,
      { operation: args.operation, limit: args.limit || 1 }
    );
    
    if (!operationLog) {
      throw new Error(`No logs found for operation: ${args.operation}`);
    }
    
    await ctx.runAction(internal.extras.hooks.sendWebhookNotification, {
      contentType: 'operation',
      data: operationLog,
      providers: args.providers,
      severity: operationLog.success ? 'success' : 'error',
    });
  },
});

// ================================================================================
// BACKWARD COMPATIBILITY
// ================================================================================

/**
 * Legacy Slack notification function for backward compatibility
 * @deprecated Use sendWebhookNotification instead
 */
export const sendSlackNotification = internalAction({
  args: {
    blocks: v.optional(v.array(v.any())),
    operation: v.optional(v.union(
      v.literal('sync'),
      v.literal('create'),
      v.literal('read'),
      v.literal('update'),
      v.literal('delete'),
    )),
    lifelogId: v.optional(v.id('lifelogs')),
  },
  handler: async (ctx, args) => {
    console.warn('sendSlackNotification is deprecated. Use sendWebhookNotification instead.');
    
    // Handle custom blocks (direct pass-through)
    if (args.blocks) {
      const manager = new WebhookManager();
      await manager.sendNotification({
        type: 'custom',
        data: args.blocks,
      }, ['slack']);
      return;
    }
    
    // Handle lifelog notification
    if (args.lifelogId) {
      await ctx.runAction(internal.extras.hooks.sendLifelogNotification, {
        lifelogId: args.lifelogId,
        providers: ['slack'],
      });
      return;
    }
    
    // Handle operation notification
    if (args.operation) {
      await ctx.runAction(internal.extras.hooks.sendOperationNotification, {
        operation: args.operation,
        providers: ['slack'],
      });
      return;
    }
    
    throw new Error('No content specified for notification');
  },
});

// ================================================================================
// ADMIN WEBHOOK ACTION
// ================================================================================

/**
 * Admin webhook notification action
 * Uses process.env.ADMIN_PW for authentication
 */
export const adminWebhookNotification = action({
  args: {
    adminValidator: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    console.log('Received admin webhook notification');
    if (args.adminValidator !== process.env.ADMIN_PW) {
      throw new Error('Invalid admin password');
    }

    const errors: string[] = [];
    
    // Send to Slack if configured
    if (process.env.SLACK_WEBHOOK_URL) {
      try {
        const slackProvider = new SlackWebhookProvider();
        const slackPayload: WebhookPayload = {
          provider: 'slack',
          content: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🔧 *Admin Notification*\n${args.message}`,
              },
            },
          ],
          metadata: {
            timestamp: Date.now(),
            severity: 'info',
            source: 'admin-webhook',
            fallbackText: `Admin Notification: ${args.message}`,
          }
        };
        
        await slackProvider.send(slackPayload);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Slack: ${errorMessage}`);
      }
    }
    
    // Send to Discord if configured
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const discordProvider = new DiscordWebhookProvider();
        const discordPayload: WebhookPayload = {
          provider: 'discord',
          content: {
            embeds: [{
              title: '🔧 Admin Notification',
              description: args.message,
              color: 0xFF6B35, // Orange color for admin notifications
              timestamp: new Date().toISOString(),
            }]
          },
          metadata: {
            timestamp: Date.now(),
            severity: 'info',
            source: 'admin-webhook',
          }
        };
        
        await discordProvider.send(discordPayload);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Discord: ${errorMessage}`);
      }
    }
    
    return {
      success: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length === 0 ? 'Admin notification sent successfully' : 'Some notifications failed',
    };
  },
});