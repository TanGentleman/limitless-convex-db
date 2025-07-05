/**
 * Slack Block Kit Helper Functions
 * 
 * This module provides helper functions for creating Slack Block Kit elements
 * based on the official Slack Block Kit documentation.
 * 
 * @see https://api.slack.com/reference/block-kit/blocks
 */

// ================================================================================
// SLACK BLOCK KIT HELPERS
// ================================================================================

/**
 * Slack Block Kit helper functions for creating rich message blocks
 */
export class SlackBlockHelpers {
  
  /**
   * Create an actions block with interactive elements
   */
  static actions(blockId: string, elements: any[]): any {
    return {
      type: 'actions',
      block_id: blockId,
      elements
    };
  }

  /**
   * Create a static select element for actions block
   */
  static staticSelect(
    actionId: string,
    placeholder: string,
    options: Array<{ text: string; value: string }>
  ): any {
    return {
      type: 'static_select',
      action_id: actionId,
      placeholder: {
        type: 'plain_text',
        text: placeholder
      },
      options: options.map(opt => ({
        text: {
          type: 'plain_text',
          text: opt.text
        },
        value: opt.value
      }))
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
  ): any {
    const button: any = {
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
   * Create a datepicker element
   */
  static datepicker(
    actionId: string,
    placeholder: string,
    initialDate?: string
  ): any {
    const datepicker: any = {
      type: 'datepicker',
      action_id: actionId,
      placeholder: {
        type: 'plain_text',
        text: placeholder
      }
    };
    
    if (initialDate) {
      datepicker.initial_date = initialDate;
    }
    
    return datepicker;
  }

  /**
   * Create an overflow menu element
   */
  static overflow(
    actionId: string,
    options: Array<{ text: string; value: string }>
  ): any {
    return {
      type: 'overflow',
      action_id: actionId,
      options: options.map(opt => ({
        text: {
          type: 'plain_text',
          text: opt.text
        },
        value: opt.value
      }))
    };
  }

  /**
   * Create a context block with contextual information
   */
  static context(elements: any[]): any {
    return {
      type: 'context',
      elements
    };
  }

  /**
   * Create a context image element
   */
  static contextImage(imageUrl: string, altText: string): any {
    return {
      type: 'image',
      image_url: imageUrl,
      alt_text: altText
    };
  }

  /**
   * Create a context markdown element
   */
  static contextMarkdown(text: string): any {
    return {
      type: 'mrkdwn',
      text
    };
  }

  /**
   * Create a divider block
   */
  static divider(): any {
    return {
      type: 'divider'
    };
  }

  /**
   * Create a file block
   */
  static file(externalId: string, source: 'remote' | 'local' = 'remote'): any {
    return {
      type: 'file',
      external_id: externalId,
      source
    };
  }

  /**
   * Create a header block
   */
  static header(text: string, emoji: boolean = true): any {
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
   * Create an image block
   */
  static image(
    imageUrl: string,
    altText: string,
    title?: string,
    blockId?: string
  ): any {
    const imageBlock: any = {
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

  /**
   * Create an image block with Slack file
   */
  static imageFromSlackFile(
    fileId: string,
    altText: string,
    title?: string,
    blockId?: string
  ): any {
    const imageBlock: any = {
      type: 'image',
      slack_file: {
        id: fileId
      },
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

  /**
   * Create an input block
   */
  static input(
    label: string,
    element: any,
    blockId?: string,
    optional?: boolean
  ): any {
    const inputBlock: any = {
      type: 'input',
      label: {
        type: 'plain_text',
        text: label,
        emoji: true
      },
      element
    };
    
    if (blockId) {
      inputBlock.block_id = blockId;
    }
    
    if (optional) {
      inputBlock.optional = optional;
    }
    
    return inputBlock;
  }

  /**
   * Create a plain text input element
   */
  static plainTextInput(
    actionId: string,
    placeholder?: string,
    multiline?: boolean
  ): any {
    const input: any = {
      type: 'plain_text_input',
      action_id: actionId
    };
    
    if (placeholder) {
      input.placeholder = {
        type: 'plain_text',
        text: placeholder
      };
    }
    
    if (multiline) {
      input.multiline = multiline;
    }
    
    return input;
  }

  /**
   * Create a markdown block (actually a section block with markdown text)
   */
  static markdown(text: string): any {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text
      }
    };
  }

  /**
   * Create a rich text block
   */
  static richText(elements: any[], blockId?: string): any {
    const richTextBlock: any = {
      type: 'rich_text',
      elements
    };
    
    if (blockId) {
      richTextBlock.block_id = blockId;
    }
    
    return richTextBlock;
  }

  /**
   * Create a rich text section
   */
  static richTextSection(elements: any[]): any {
    return {
      type: 'rich_text_section',
      elements
    };
  }

  /**
   * Create a rich text list
   */
  static richTextList(
    elements: any[],
    style: 'bullet' | 'ordered' = 'bullet',
    indent: number = 0
  ): any {
    return {
      type: 'rich_text_list',
      style,
      indent,
      elements
    };
  }

  /**
   * Create a rich text preformatted section
   */
  static richTextPreformatted(text: string, border: number = 0): any {
    return {
      type: 'rich_text_preformatted',
      elements: [
        {
          type: 'text',
          text
        }
      ],
      border
    };
  }

  /**
   * Create a rich text quote
   */
  static richTextQuote(text: string): any {
    return {
      type: 'rich_text_quote',
      elements: [
        {
          type: 'text',
          text
        }
      ]
    };
  }

  /**
   * Create a rich text element with styling
   */
  static richTextElement(
    text: string,
    style?: {
      bold?: boolean;
      italic?: boolean;
      strike?: boolean;
      code?: boolean;
    }
  ): any {
    const element: any = {
      type: 'text',
      text
    };
    
    if (style) {
      element.style = style;
    }
    
    return element;
  }

  /**
   * Create a rich text link element
   */
  static richTextLink(url: string, text?: string): any {
    const linkElement: any = {
      type: 'link',
      url
    };
    
    if (text) {
      linkElement.text = text;
    }
    
    return linkElement;
  }

  /**
   * Create a rich text emoji element
   */
  static richTextEmoji(name: string): any {
    return {
      type: 'emoji',
      name
    };
  }

  /**
   * Create a rich text user mention element
   */
  static richTextUser(userId: string): any {
    return {
      type: 'user',
      user_id: userId
    };
  }

  /**
   * Create a rich text channel mention element
   */
  static richTextChannel(channelId: string): any {
    return {
      type: 'channel',
      channel_id: channelId
    };
  }

  /**
   * Create a rich text date element
   */
  static richTextDate(
    timestamp: number,
    format: string = '{date_num} at {time}',
    fallback?: string
  ): any {
    return {
      type: 'date',
      timestamp,
      format,
      fallback: fallback || 'date'
    };
  }

  /**
   * Create a section block
   */
  static section(
    text: string,
    textType: 'mrkdwn' | 'plain_text' = 'mrkdwn',
    fields?: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }>,
    accessory?: any,
    blockId?: string
  ): any {
    const sectionBlock: any = {
      type: 'section',
      text: {
        type: textType,
        text
      }
    };
    
    if (fields) {
      sectionBlock.fields = fields;
    }
    
    if (accessory) {
      sectionBlock.accessory = accessory;
    }
    
    if (blockId) {
      sectionBlock.block_id = blockId;
    }
    
    return sectionBlock;
  }

  /**
   * Create a video block
   */
  static video(
    videoUrl: string,
    thumbnailUrl: string,
    altText: string,
    title?: string,
    titleUrl?: string,
    description?: string
  ): any {
    const videoBlock: any = {
      type: 'video',
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      alt_text: altText
    };
    
    if (title) {
      videoBlock.title = {
        type: 'plain_text',
        text: title,
        emoji: true
      };
    }
    
    if (titleUrl) {
      videoBlock.title_url = titleUrl;
    }
    
    if (description) {
      videoBlock.description = {
        type: 'plain_text',
        text: description,
        emoji: true
      };
    }
    
    return videoBlock;
  }

  /**
   * Create a complete message with multiple blocks
   */
  static message(blocks: any[], text?: string): any {
    const message: any = {
      blocks
    };
    
    if (text) {
      message.text = text;
    }
    
    return message;
  }

  /**
   * Create a modal view structure
   */
  static modal(
    title: string,
    blocks: any[],
    submit?: string,
    close?: string,
    callbackId?: string
  ): any {
    const modal: any = {
      type: 'modal',
      title: {
        type: 'plain_text',
        text: title
      },
      blocks
    };
    
    if (submit) {
      modal.submit = {
        type: 'plain_text',
        text: submit
      };
    }
    
    if (close) {
      modal.close = {
        type: 'plain_text',
        text: close
      };
    }
    
    if (callbackId) {
      modal.callback_id = callbackId;
    }
    
    return modal;
  }

  /**
   * Create a home tab view structure
   */
  static homeTab(blocks: any[]): any {
    return {
      type: 'home',
      blocks
    };
  }
}

// ================================================================================
// SLACK MESSAGE BUILDERS
// ================================================================================

/**
 * High-level message builders for common use cases
 */
export class SlackMessageBuilder {
  
  /**
   * Build a status update message
   */
  static statusUpdate(
    title: string,
    status: 'success' | 'warning' | 'error' | 'info',
    details: string,
    additionalFields?: Array<{ name: string; value: string }>
  ): any[] {
    const statusEmoji = {
      success: '✅',
      warning: '⚠️',
      error: '❌',
      info: 'ℹ️'
    };
    
    const blocks = [
      SlackBlockHelpers.header(`${statusEmoji[status]} ${title}`),
      SlackBlockHelpers.section(details)
    ];
    
         if (additionalFields && additionalFields.length > 0) {
       blocks.push(SlackBlockHelpers.divider());
       const fields: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }> = additionalFields.map(field => ({
         type: 'mrkdwn',
         text: `*${field.name}:*\n${field.value}`
       }));
       blocks.push(SlackBlockHelpers.section(
         'Additional Information:',
         'mrkdwn',
         fields
       ));
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
  ): any[] {
    const blocks = [
      SlackBlockHelpers.header(`📊 ${title}`)
    ];
    
         // Add metrics in pairs
     for (let i = 0; i < metrics.length; i += 2) {
       const fields: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }> = [];
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
      
      blocks.push(SlackBlockHelpers.section('', 'mrkdwn', fields));
    }
    
    if (timestamp) {
      blocks.push(SlackBlockHelpers.context([
        SlackBlockHelpers.contextMarkdown(`📅 Updated: ${timestamp.toLocaleString()}`)
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
  ): any[] {
    const blocks = [
      SlackBlockHelpers.header(`🔍 ${title}`),
      SlackBlockHelpers.section(description),
      SlackBlockHelpers.divider()
    ];
    
         // Add details
     for (let i = 0; i < details.length; i += 2) {
       const fields: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }> = [];
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
      
      blocks.push(SlackBlockHelpers.section('', 'mrkdwn', fields));
    }
    
    // Add action buttons
    blocks.push(SlackBlockHelpers.divider());
    blocks.push(SlackBlockHelpers.actions('approval_actions', [
      SlackBlockHelpers.button(approveActionId, 'Approve', 'approve', 'primary'),
      SlackBlockHelpers.button(rejectActionId, 'Reject', 'reject', 'danger')
    ]));
    
    return blocks;
  }
} 