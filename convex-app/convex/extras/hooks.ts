'use node';

import { IncomingWebhook } from '@slack/webhook';
import { action, internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { formatDate, formatMarkdown } from './utils';
import { Doc } from '../_generated/dataModel';
import { SlackBlockHelpers, SlackMessageBuilder } from './slackBlockHelpers';



// ================================================================================
// TYPE DEFINITIONS (ADDED FOR BETTER ORGANIZATION)
// ================================================================================

/**
 * Supported webhook providers
 */
export type WebhookProvider = 'slack' | 'discord' | 'custom';

/**
 * Content types that can be sent via webhooks
 */
export type WebhookContentType = 'lifelog' | 'operation' | 'custom';

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
interface WebhookContent {
  type: WebhookContentType;
  data: any; // We can't avoid any entirely, but we'll handle it in the formatter functions
  title?: string;
  severity?: NotificationSeverity;
  context?: Record<string, any>;
}

/**
 * Result of a webhook notification attempt
 */
type WebhookResult = {
  success: boolean;
  message: string;
  errors?: string[];
  providers?: WebhookProvider[];
};

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
// CONTENT FORMATTERS (REFACTORED TO FUNCTIONAL STYLE)
// ================================================================================

type FormatterFunction = (
  data: any,
  options: { title?: string; severity?: NotificationSeverity; context?: Record<string, any> }
) => Record<string, any>;

const formatters: Record<WebhookContentType, FormatterFunction> = {
  lifelog: (lifelog, options) => {
    const timestamp = formatDate(new Date(lifelog.startTime));
    const markdown = lifelog.markdown || 'No content available';
    const processedMarkdown = formatMarkdown(markdown, true);
    const title = options.title || lifelog.title || 'Untitled Lifelog';
    
    return {
      slack: [
        SlackBlockHelpers.header('📝 Latest Lifelog Entry'),
        SlackBlockHelpers.section(`*Title:* ${title}\n*Created:* ${timestamp}`, 'mrkdwn'),
        SlackBlockHelpers.divider(),
        SlackBlockHelpers.section(processedMarkdown.substring(0, 2000) + (processedMarkdown.length > 2000 ? '...' : ''), 'mrkdwn'),
        SlackBlockHelpers.context([
          SlackBlockHelpers.contextMarkdown(`💡 *Lifelog ID:* ${lifelog.lifelogId}`),
          SlackBlockHelpers.contextMarkdown(`⏰ *Duration:* ${Math.round((lifelog.endTime - lifelog.startTime) / 1000 / 60)} minutes`)
        ])
      ],
      discord: {
        embeds: [{
          title: '📝 Latest Lifelog Entry',
          color: 0x5865F2,
          fields: [
            { name: 'Title', value: title, inline: true },
            { name: 'Created', value: timestamp, inline: true },
          ],
          description: processedMarkdown.substring(0, 2000) + (processedMarkdown.length > 2000 ? '...' : ''),
          timestamp: new Date(lifelog.startTime).toISOString(),
        }]
      },
      generic: {
        type: 'lifelog',
        title,
        timestamp,
        content: markdown,
        metadata: {
          lifelogId: lifelog.lifelogId,
          startTime: lifelog.startTime,
          endTime: lifelog.endTime,
        }
      }
    };
  },
  
  operation: (operation, options) => {
    const timestamp = formatDate(new Date(operation._creationTime));
    const status = operation.success ? '✅ Success' : '❌ Failure';
    const details = operation.data?.error || operation.data?.message || 'No details available';
    
    return {
      slack: [
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
      ],
      discord: {
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
      },
      generic: {
        type: 'operation',
        operation: operation.operation,
        success: operation.success,
        timestamp,
        details,
        metadata: {
          table: operation.table,
          creationTime: operation._creationTime,
        }
      }
    };
  },
  
  custom: (data) => ({ 
    slack: data, 
    discord: data, 
    generic: data 
  })
};

// ================================================================================
// WEBHOOK MANAGER (UPDATED WITH RETURN TYPE)
// ================================================================================

const webhookManager = {
  providers: {
    slack: new SlackWebhookProvider(),
    discord: new DiscordWebhookProvider(),
    custom: new CustomWebhookProvider()
  },
  
  getAvailableProviders(): WebhookProvider[] {
    return (['slack', 'discord', 'custom'] as WebhookProvider[]).filter(
      provider => this.providers[provider].isConfigured()
    );
  },
  
  async sendNotification(
    contentType: WebhookContentType,
    data: any,
    providers: WebhookProvider[],
    options: { title?: string; severity?: NotificationSeverity; context?: Record<string, any> } = {}
  ): Promise<WebhookResult> {
    const formatter = formatters[contentType];
    if (!formatter) throw new Error(`Unsupported content type: ${contentType}`);
    
    const formatted = formatter(data, options);
    const errors: string[] = [];
    const successfulProviders: WebhookProvider[] = [];
    
    for (const provider of providers) {
      try {
        const providerInstance = this.providers[provider];
        if (!providerInstance.isConfigured()) continue;
        
        await providerInstance.send({
          provider,
          content: formatted[provider] || formatted.generic,
          metadata: {
            timestamp: Date.now(),
            severity: options.severity || 'info',
            source: 'limitless-webhook-system',
            ...options.context
          }
        });
        successfulProviders.push(provider);
      } catch (error) {
        errors.push(`${provider}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return {
      success: successfulProviders.length > 0,
      message: successfulProviders.length > 0 
        ? `Notification sent to ${successfulProviders.join(', ')}` 
        : `All providers failed: ${errors.join(', ')}`,
      errors: errors.length > 0 ? errors : undefined,
      providers: successfulProviders,
    };
  }
};

// ================================================================================
// MAIN WEBHOOK ACTION (UPDATED WITH RETURN TYPE)
// ================================================================================

/**
 * Sends a webhook notification to specified providers
 * @param {WebhookContentType} contentType - Type of content to send
 * @param {any} data - Content data
 * @param {WebhookProvider[]} [providers] - Providers to use (default: all configured)
 * @param {string} [title] - Notification title
 * @param {NotificationSeverity} [severity] - Notification severity
 * @param {Record<string, any>} [context] - Additional context metadata
 * @returns {Promise<WebhookResult>} Result of the notification attempt
 */
export const sendWebhookNotification = internalAction({
  args: {
    contentType: v.union(
      v.literal('lifelog'),
      v.literal('operation'),
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
  handler: async (ctx, args): Promise<WebhookResult> => {
    const result = await webhookManager.sendNotification(
      args.contentType,
      args.data,
      args.providers || webhookManager.getAvailableProviders(),
      {
        title: args.title,
        severity: args.severity,
        context: args.context
      }
    );
    return result;
  },
});

// ================================================================================
// CONVENIENCE WRAPPERS (UPDATED WITH RETURN TYPES)
// ================================================================================

/**
 * Sends a lifelog notification to specified providers
 * @param {IdString<'lifelogs'>} lifelogId - ID of the lifelog to notify about
 * @param {WebhookProvider[]} [providers] - Providers to use (default: all configured)
 * @param {string} [title] - Custom notification title
 * @returns {Promise<WebhookResult>} Result of the notification attempt
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
  handler: async (ctx, args): Promise<WebhookResult> => {
    const lifelogs = await ctx.runQuery(internal.lifelogs.getDocsById, {
      ids: [args.lifelogId],
    });
    
    if (lifelogs.length === 0) {
      throw new Error(`Lifelog not found: ${args.lifelogId}`);
    }
    
    const result = await ctx.runAction(internal.extras.hooks.sendWebhookNotification, {
      contentType: 'lifelog',
      data: lifelogs[0],
      providers: args.providers,
      title: args.title,
      severity: 'info',
    });
    return result;
  },
});

/**
 * Sends an operation notification to specified providers
 * @param {'sync'|'create'|'read'|'update'|'delete'} operation - Operation type
 * @param {WebhookProvider[]} [providers] - Providers to use (default: all configured)
 * @returns {Promise<WebhookResult>} Result of the notification attempt
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
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    const [operationLog] = await ctx.runQuery(
      internal.extras.tests.getLogsByOperation,
      { operation: args.operation, limit: 1 }
    );
    
    if (!operationLog) {
      throw new Error(`No logs found for operation: ${args.operation}`);
    }
    
    const result = await ctx.runAction(internal.extras.hooks.sendWebhookNotification, {
      contentType: 'operation',
      data: operationLog,
      providers: args.providers,
      severity: operationLog.success ? 'success' : 'error',
    });
    return result;
  },
});

// ================================================================================
// ADMIN WEBHOOK ACTION (REFACTORED)
// ================================================================================

/**
 * Sends an admin notification to all configured providers
 * @param {string} adminValidator - Admin password for authentication
 * @param {string} message - Notification message
 * @returns {Promise<WebhookResult>} Result of the notification attempt
 */
export const adminWebhookNotification = internalAction({
  args: {
    adminValidator: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    if (args.adminValidator !== process.env.ADMIN_PW) {
      return {
        success: false,
        message: 'Invalid admin password',
        errors: ['Authentication failed']
      };
    }

    return await webhookManager.sendNotification(
      'custom',
      {
        slack: [SlackBlockHelpers.section(`🔧 *Admin Notification*\n${args.message}`)],
        discord: {
          embeds: [{
            title: '🔧 Admin Notification',
            description: args.message,
            color: 0xFF6B35
          }]
        }
      },
      webhookManager.getAvailableProviders(),
      {
        severity: 'info',
        context: { source: 'admin-webhook' }
      }
    );
  },
});

export const publicNotification = action({
  args: {
    message: v.string(),
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    const result = await ctx.runAction(internal.extras.hooks.adminWebhookNotification, {
      adminValidator: process.env.ADMIN_PW!,
      message: args.message,
    });
    return result;
  }
})

// ================================================================================
// EXAMPLE USAGE OF SLACK BLOCK HELPERS (UPDATED TO USE webhookManager)
// ================================================================================

/**
 * Example action demonstrating how to use SlackBlockHelpers to create rich messages
 */
export const sendRichSlackExample = internalAction({
  args: {
    userId: v.optional(v.string()),
    channelId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Create a rich message using the SlackBlockHelpers
    const richBlocks = [
      // Header with emoji
      SlackBlockHelpers.header('🚀 System Status Dashboard'),
      
      // Section with formatted text and fields
      SlackBlockHelpers.section(
        '*Welcome to the Limitless System Status!*\nHere\'s what\'s happening right now:',
        'mrkdwn',
        [
          { type: 'mrkdwn', text: '*Active Users:*\n42' },
          { type: 'mrkdwn', text: '*System Health:*\n✅ All Good' }
        ]
      ),
      
      // Divider
      SlackBlockHelpers.divider(),
      
      // Rich text with various formatting
      SlackBlockHelpers.richText([
        SlackBlockHelpers.richTextSection([
          SlackBlockHelpers.richTextElement('Latest activity: ', { bold: true }),
          SlackBlockHelpers.richTextElement('Data sync completed successfully'),
          SlackBlockHelpers.richTextEmoji('white_check_mark')
        ])
      ]),
      
      // Context with image and info
      SlackBlockHelpers.context([
        SlackBlockHelpers.contextImage(
          'https://via.placeholder.com/16x16?text=📊',
          'Dashboard icon'
        ),
        SlackBlockHelpers.contextMarkdown('Last updated: <!date^1640995200^{date_num} at {time}|Dec 31, 2024 at 12:00 PM>')
      ]),
      
      // Interactive actions
      SlackBlockHelpers.actions('dashboard_actions', [
        SlackBlockHelpers.button('refresh_data', 'Refresh Data', 'refresh', 'primary'),
        SlackBlockHelpers.button('view_logs', 'View Logs', 'logs'),
        SlackBlockHelpers.staticSelect(
          'quick_actions',
          'Quick Actions...',
          [
            { text: 'Export Data', value: 'export' },
            { text: 'Run Sync', value: 'sync' },
            { text: 'View Analytics', value: 'analytics' }
          ]
        )
      ])
    ];
    
    // Add user mention if provided
    if (args.userId) {
      richBlocks.splice(1, 0, SlackBlockHelpers.richText([
        SlackBlockHelpers.richTextSection([
          SlackBlockHelpers.richTextElement('Hey '),
          SlackBlockHelpers.richTextUser(args.userId),
          SlackBlockHelpers.richTextElement(', check out this status update!')
        ])
      ]));
    }
    
    // Add channel mention if provided
    if (args.channelId) {
      richBlocks.push(SlackBlockHelpers.context([
        SlackBlockHelpers.contextMarkdown('Also posted in '),
        SlackBlockHelpers.contextMarkdown(`<#${args.channelId}>`)
      ]));
    }
    
    // Send the rich message using webhookManager
    const result = await webhookManager.sendNotification(
      'custom',
      richBlocks,
      ['slack'],
      { severity: 'info' }
    );
    
    return result;
  },
});

/**
 * Example action for creating interactive forms in Slack
 */
export const sendInteractiveFormExample = internalAction({
  args: {
    formTitle: v.string(),
    callbackId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Create an interactive form using helpers
    const formBlocks = [
      SlackBlockHelpers.header(`📋 ${args.formTitle}`),
      SlackBlockHelpers.section('Please fill out the following information:'),
      
      // Text input
      SlackBlockHelpers.input(
        'Full Name',
        SlackBlockHelpers.plainTextInput('name_input', 'Enter your full name...')
      ),
      
      // Multi-line text input
      SlackBlockHelpers.input(
        'Description',
        SlackBlockHelpers.plainTextInput('description_input', 'Describe your request...', true)
      ),
      
      // Date picker
      SlackBlockHelpers.input(
        'Preferred Date',
        SlackBlockHelpers.datepicker('date_input', 'Select a date...')
      ),
      
      // Select dropdown
      SlackBlockHelpers.input(
        'Priority Level',
        SlackBlockHelpers.staticSelect(
          'priority_input',
          'Choose priority...',
          [
            { text: 'Low', value: 'low' },
            { text: 'Medium', value: 'medium' },
            { text: 'High', value: 'high' },
            { text: 'Urgent', value: 'urgent' }
          ]
        )
      ),
      
      // Submit actions
      SlackBlockHelpers.actions('form_actions', [
        SlackBlockHelpers.button('submit_form', 'Submit', 'submit', 'primary'),
        SlackBlockHelpers.button('cancel_form', 'Cancel', 'cancel')
      ])
    ];
    
    // Send the interactive form using webhookManager
    const result = await webhookManager.sendNotification(
      'custom',
      formBlocks,
      ['slack'],
      { severity: 'info' }
    );
    
    return result;
  },
});

/**
 * Public action to send rich Slack example (for testing)
 */
export const publicRichSlackExample = action({
  args: {
    userId: v.optional(v.string()),
    channelId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.extras.hooks.sendRichSlackExample, {
      userId: args.userId,
      channelId: args.channelId,
    });
  }
});