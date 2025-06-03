import { v } from 'convex/values';
import { query, action } from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc } from '../_generated/dataModel';
import { PaginationResult } from 'convex/server';

// Alias for lifelog document type
type Lifelog = Doc<'lifelogs'>;

export const getPreviewLifelog = query({
  handler: async (ctx) => {
    const lastLifelog = await ctx.db
      .query('lifelogs')
      .withIndex('by_start_time')
      .order('desc')
      .first();
    if (lastLifelog === null) {
      return null;
    }
    return lastLifelog;
  },
});

/**
 * Retrieves the most recent lifelog.
 * Optionally sends a Slack notification if requested.
 *
 * @param sendNotification - If true, sends a Slack notification for the lifelog.
 * @returns The most recent lifelog document.
 */
export const getLastLifelog = action({
  args: {
    sendNotification: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Lifelog> => {
    // Fetch the most recent lifelog (sorted by default direction)
    const result: PaginationResult<Lifelog> = await ctx.runQuery(
      internal.lifelogs.paginatedDocs,
      {
        paginationOpts: {
          numItems: 1,
          cursor: null,
        },
      },
    );

    const lifelog = result.page?.[0];
    if (!lifelog) {
      throw new Error('No lifelogs found');
    }

    // Optionally send a Slack notification
    if (args.sendNotification) {
      await ctx.runAction(internal.extras.hooks.sendSlackNotification, {
        lifelogId: lifelog._id,
      });
    }

    return lifelog;
  },
});
