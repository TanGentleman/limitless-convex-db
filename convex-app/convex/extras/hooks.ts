'use node';

import { IncomingWebhook } from '@slack/webhook';
import { action, internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { formatDate, formatMarkdown } from './utils';
import type {
  Block,
  KnownBlock,
  MessageAttachment,
  SectionBlock,
  ContextBlock,
  DividerBlock,
  HeaderBlock,
  ActionsBlock,
  Button,
  StaticSelect,
  PlainTextElement,
  MrkdwnElement,
  ImageBlock,
  RichTextBlock,
  Option,
  View,
  HomeView,
  ModalView
} from '@slack/types';

// ================================================================================
// TYPE DEFINITIONS
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
 * Simplified notification data structure
 */
export interface NotificationData {
  title: string;
  message: string;
  severity?: NotificationSeverity;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: Date;
}

/**
 * Discord embed structure for type safety
 */
interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: string;
  footer?: { text: string };
}

/**
 * Discord webhook payload
 */
interface DiscordWebhookPayload {
  embeds: DiscordEmbed[];
}

// ================================================================================
// SLACK BLOCK BUILDERS USING OFFICIAL TYPES
// ================================================================================

/**
 * Modern Slack Block builders using official @slack/types
 */
export class SlackBlockBuilder {
  /**
   * Create a section block with proper typing
   */
  static section(options: {
    text?: string;
    textType?: 'mrkdwn' | 'plain_text';
    fields?: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }>;
    accessory?: Button | StaticSelect | any;
    blockId?: string;
  }): SectionBlock {
    const block: SectionBlock = {
      type: 'section'
    };

    if (options.fields && options.fields.length > 0) {
      block.fields = options.fields.map(field => ({
        type: field.type,
        text: field.text
      }));
    } else if (options.text) {
      const textType = options.textType || 'mrkdwn';
      if (textType === 'mrkdwn') {
        block.text = {
          type: 'mrkdwn',
          text: options.text
        } as MrkdwnElement;
      } else {
        block.text = {
          type: 'plain_text',
          text: options.text,
          emoji: true
        } as PlainTextElement;
      }
    }

    if (options.accessory) {
      block.accessory = options.accessory;
    }

    if (options.blockId) {
      block.block_id = options.blockId;
    }

    return block;
  }

  /**
   * Create a header block
   */
  static header(text: string, emoji: boolean = true): HeaderBlock {
    return {
      type: 'header',
      text: {
        type: 'plain_text',
        text,
        emoji
      }
    };
  }

  /**
   * Create a divider block
   */
  static divider(): DividerBlock {
    return {
      type: 'divider'
    };
  }

  /**
   * Create a context block
   */
  static context(elements: Array<MrkdwnElement | PlainTextElement | ImageBlock>): ContextBlock {
    return {
      type: 'context',
      elements
    };
  }

  /**
   * Create a context markdown element
   */
  static contextMarkdown(text: string): MrkdwnElement {
    return {
      type: 'mrkdwn',
      text
    };
  }

  /**
   * Create an actions block
   */
  static actions(blockId: string, elements: Array<Button | StaticSelect>): ActionsBlock {
    return {
      type: 'actions',
      block_id: blockId,
      elements
    };
  }

  /**
   * Create a button element
   */
  static button(
    actionId: string,
    text: string,
    value: string,
    style?: 'primary' | 'danger'
  ): Button {
    const button: Button = {
      type: 'button',
      action_id: actionId,
      text: {
        type: 'plain_text',
        text
      },
      value
    };
    
    if (style) {
      button.style = style;
    }
    
    return button;
  }

  /**
   * Create an image block
   */
  static image(
    imageUrl: string,
    altText: string,
    title?: string,
    blockId?: string
  ): ImageBlock {
    const imageBlock: ImageBlock = {
      type: 'image',
      image_url: imageUrl,
      alt_text: altText
    };
    
    if (title) {
      imageBlock.title = {
        type: 'plain_text',
        text: title
      };
    }
    
    if (blockId) {
      imageBlock.block_id = blockId;
    }
    
    return imageBlock;
  }
}

/**
 * High-level message builders for common use cases
 */
export class SlackMessageBuilder {
  /**
   * Build a status update message using proper Slack types
   */
  static statusUpdate(
    title: string,
    status: 'success' | 'warning' | 'error' | 'info',
    details: string,
    additionalFields?: Array<{ name: string; value: string }>
  ): KnownBlock[] {
    const statusEmoji = {
      success: '✅',
      warning: '⚠️',
      error: '❌',
      info: 'ℹ️'
    };

    const blocks: KnownBlock[] = [
      SlackBlockBuilder.header(`${statusEmoji[status]} ${title}`),
      SlackBlockBuilder.section({ text: details })
    ];

    if (additionalFields && additionalFields.length > 0) {
      blocks.push(SlackBlockBuilder.divider());
      blocks.push(SlackBlockBuilder.section({ text: 'Additional Information:' }));

      const fields = additionalFields.map(field => ({
        type: 'mrkdwn' as const,
        text: `*${field.name}:*\n${field.value}`
      }));

      blocks.push(SlackBlockBuilder.section({ fields }));
    }

    return blocks;
  }
  
  /**
   * Build a data summary message
   */
  static dataSummary(
    title: string,
    metrics: Array<{ label: string; value: string | number; trend?: 'up' | 'down' | 'neutral' }>,
    timestamp?: Date
  ): KnownBlock[] {
    const blocks: KnownBlock[] = [
      SlackBlockBuilder.header(`📊 ${title}`)
    ];
    
    // Add metrics in pairs
    for (let i = 0; i < metrics.length; i += 2) {
      const fields: Array<{ type: 'mrkdwn'; text: string }> = [];
      const metric1 = metrics[i];
      const metric2 = metrics[i + 1];
      
      const trendEmoji = (trend?: string) => {
        switch (trend) {
          case 'up': return '📈';
          case 'down': return '📉';
          case 'neutral': return '➡️';
          default: return '';
        }
      };
      
      fields.push({
        type: 'mrkdwn',
        text: `*${metric1.label}:*\n${metric1.value} ${trendEmoji(metric1.trend)}`
      });
      
      if (metric2) {
        fields.push({
          type: 'mrkdwn',
          text: `*${metric2.label}:*\n${metric2.value} ${trendEmoji(metric2.trend)}`
        });
      }
      
      blocks.push(SlackBlockBuilder.section({ fields }));
    }
    
    if (timestamp) {
      blocks.push(SlackBlockBuilder.context([
        SlackBlockBuilder.contextMarkdown(`📅 Updated: ${timestamp.toLocaleString()}`)
      ]));
    }
    
    return blocks;
  }
  
  /**
   * Build an interactive approval message
   */
  static approvalRequest(
    title: string,
    description: string,
    details: Array<{ label: string; value: string }>,
    approveActionId: string = 'approve',
    rejectActionId: string = 'reject'
  ): KnownBlock[] {
    const blocks: KnownBlock[] = [
      SlackBlockBuilder.header(`🔍 ${title}`),
      SlackBlockBuilder.section({ text: description }),
      SlackBlockBuilder.divider()
    ];
    
    // Add details
    for (let i = 0; i < details.length; i += 2) {
      const fields: Array<{ type: 'mrkdwn'; text: string }> = [];
      const detail1 = details[i];
      const detail2 = details[i + 1];
      
      fields.push({
        type: 'mrkdwn',
        text: `*${detail1.label}:*\n${detail1.value}`
      });
      
      if (detail2) {
        fields.push({
          type: 'mrkdwn',
          text: `*${detail2.label}:*\n${detail2.value}`
        });
      }
      
      blocks.push(SlackBlockBuilder.section({ fields }));
    }
    
    // Add action buttons
    blocks.push(SlackBlockBuilder.divider());
    blocks.push(SlackBlockBuilder.actions('approval_actions', [
      SlackBlockBuilder.button(approveActionId, 'Approve', 'approve', 'primary'),
      SlackBlockBuilder.button(rejectActionId, 'Reject', 'reject', 'danger')
    ]));
    
    return blocks;
  }
}

// ================================================================================
// WEBHOOK MANAGER WITH PROPER TYPING
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
    
    let blocks: KnownBlock[];
    
    if (!data.fields || data.fields.length === 0) {
      // Simple message format
      const message = formatMarkdown(data.message, false, 2000);
      
      blocks = [
        SlackBlockBuilder.section({
          text: `*${data.title}*\n${message}`,
          textType: 'mrkdwn'
        })
      ];
    } else {
      // Complex message with fields
      const message = formatMarkdown(data.message, true, 2000);
      blocks = SlackMessageBuilder.statusUpdate(
        data.title,
        data.severity || 'info',
        message,
        data.fields?.map(f => ({ name: f.name, value: f.value }))
      );
    }
    
    // Add truncation notice if needed
    if (isTruncated) {
      blocks.push(SlackBlockBuilder.context([
        SlackBlockBuilder.contextMarkdown('⚠️ _Message truncated due to length limits_')
      ]));
    }
    
    console.log('Slack blocks:', JSON.stringify(blocks, null, 2));
    await webhook.send({ blocks });
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

    const payload: DiscordWebhookPayload = { embeds: [embed] };
    const response = await fetch(process.env.DISCORD_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Discord webhook failed:', response.status, errorText);
      throw new Error(`Discord webhook failed: ${response.status}`);
    }
    
    console.log('Discord notification sent successfully');
  }

  /**
   * Send raw Slack blocks with proper typing
   */
  async sendRawSlackBlocks(blocks: KnownBlock[]): Promise<WebhookResult> {
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
// INTERNAL ACTIONS WITH PROPER TYPING
// ================================================================================

/**
 * Send a simple notification to webhooks
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
    
    const markdown = lifelog.markdown || 'No content available';
    const previewLength = 500;
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
// PUBLIC ACTIONS WITH PROPER TYPING
// ================================================================================

/**
 * Public action to send notifications
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
 * Public action to send properly typed Slack Block Kit notifications
 * 
 * This action allows external callers to send properly formatted Slack Block Kit messages.
 * The blocks must conform to Slack's Block Kit specification using official @slack/types.
 * 
 * @param blocks - Array of properly typed Slack Block Kit blocks
 * @returns Promise<WebhookResult> - Result indicating success/failure
 */
export const publicSlackNotification = action({
  args: {
    blocks: v.array(v.any()) // Runtime validation is complex for union types
  },
  handler: async (ctx, args): Promise<WebhookResult> => {
    // Cast to proper Slack types - runtime validation would be complex
    const blocks = args.blocks as KnownBlock[];
    return await webhookManager.sendRawSlackBlocks(blocks);
  }
});

// ================================================================================
// CONVENIENCE HELPERS
// ================================================================================

/**
 * Quick notification builders with proper typing
 */
export const NotificationHelpers = {
  success: (title: string, message: string): NotificationData => 
    ({ title, message, severity: 'success' }),
  
  error: (title: string, message: string): NotificationData => 
    ({ title, message, severity: 'error' }),
  
  info: (title: string, message: string): NotificationData => 
    ({ title, message, severity: 'info' }),
  
  warning: (title: string, message: string): NotificationData => 
    ({ title, message, severity: 'warning' })
};

/**
 * Send an operation notification based on actual operation logs
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

// Re-export official Slack types for external use
// export type {
//   Block,
//   KnownBlock,
//   MessageAttachment,
//   SectionBlock,
//   ContextBlock,
//   DividerBlock,
//   HeaderBlock,
//   ActionsBlock,
//   Button,
//   StaticSelect,
//   PlainTextElement,
//   MrkdwnElement,
//   ImageBlock,
//   RichTextBlock,
//   Option,
//   View,
//   HomeView,
//   ModalView
// } from '@slack/types';