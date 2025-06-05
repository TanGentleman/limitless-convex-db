import { v } from 'convex/values';
import { Doc } from './_generated/dataModel';

/**
 * Request parameters for retrieving lifelogs from the Limitless API.
 *
 * These parameters match the Limitless API query parameters with some
 * additional handling specific to our sync implementation.
 */
export type LifelogRequest = {
  /** IANA timezone specifier (e.g. "America/New_York"). Default: UTC */
  timezone?: string;

  /** Format: YYYY-MM-DD - Used to replace start/end values when they are not provided */
  date?: string;

  /** ISO-8601 format start date */
  start?: string;

  /** ISO-8601 format end date */
  end?: string;

  /** Pagination cursor returned from previous API calls */
  cursor?: string;

  /**
   * Sort direction for results. Required by fetchLifelogs.
   * - "asc": oldest first (used for initial sync)
   * - "desc": newest first (used for subsequent syncs)
   */
  direction?: 'asc' | 'desc';

  /** Whether to include markdown content in results. Default: true */
  includeMarkdown?: boolean;

  /** Whether to include headings in results. Default: true */
  includeHeadings?: boolean;

  /** Maximum entries to return per batch - Handled internally by fetchLifelogs */
  limit?: number;
};

/**
 * Database query parameters for retrieving lifelogs from the Convex database.
 *
 * These parameters are used internally by the paginatedDocs query to filter
 * and sort lifelog documents.
 */
export type LifelogQueryParams = {
  /** Pagination options including cursor and number of items */
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };

  /** Optional minimum startTime as unix timestamp (inclusive) */
  startTime?: number;

  /** Optional maximum endTime as unix timestamp (inclusive) */
  endTime?: number;

  // TODO: Implement isStarred filter
  isStarred?: boolean;

  direction: 'asc' | 'desc';
};

type ContentNode = {
  type: 'heading1' | 'heading2' | 'heading3' | 'blockquote' | 'paragraph';
  content: string;
  startTime?: string; // ISO format
  endTime?: string; // ISO format
  startOffsetMs?: number;
  endOffsetMs?: number;
  children?: ContentNode[];
  speakerName?: string | null;
  speakerIdentifier?: 'user' | null;
};

// Conforms to the Limitless API spec in openapi.yaml
export type LimitlessLifelog = {
  id: string;
  title: string;
  markdown: string | null;
  startTime: string; // ISO format
  endTime: string; // ISO format
  updatedAt: string; // ISO format
  isStarred: boolean;
  contents: ContentNode[];
};

export type ConvexLifelogs = Omit<Doc<'lifelogs'>, '_id' | '_creationTime'>;

/**
 * Converts lifelogs from API format to Convex database format.
 *
 * @param lifelogs - Array of lifelogs from the API
 * @returns Array of lifelogs in Convex format
 */
export const convertToConvexFormat = (
  lifelogs: LimitlessLifelog[],
): ConvexLifelogs[] => {
  return lifelogs.map((log) => {
    if (!log.startTime || !log.endTime) {
      throw new Error(`Lifelog ${log.id} is missing required time fields`);
    }
    return {
      lifelogId: log.id,
      title: log.title,
      markdown: log.markdown,
      contents: log.contents.map((content) => ({
        type: content.type,
        content: content.content,
        startTime: content.startTime
          ? new Date(content.startTime).getTime()
          : undefined,
        endTime: content.endTime
          ? new Date(content.endTime).getTime()
          : undefined,
      })),
      startTime: new Date(log.startTime).getTime(),
      endTime: new Date(log.endTime).getTime(),
      updatedAt: new Date(log.updatedAt).getTime(),
      isStarred: log.isStarred,
      embeddingId: null,
    };
  });
};

/**
 * Converts lifelogs from Convex database format to API format.
 *
 * @param lifelogs - Array of lifelogs from the Convex database
 * @returns Array of lifelogs in Limitless API format
 */
export const convertToLimitlessFormat = (
  lifelogs: ConvexLifelogs[],
): LimitlessLifelog[] => {
  return lifelogs.map((log) => {
    return {
      id: log.lifelogId,
      title: log.title,
      markdown: log.markdown,
      startTime: new Date(log.startTime).toISOString(),
      endTime: new Date(log.endTime).toISOString(),
      // NOTE: updatedAt should not remain optional in the DB
      updatedAt: new Date(log.updatedAt || log.endTime).toISOString(),
      isStarred: log.isStarred ?? false,
      contents: log.contents.map((content) => {
        return {
          type: content.type,
          content: content.content,
          startTime: content.startTime
            ? new Date(content.startTime).toISOString()
            : undefined,
          endTime: content.endTime
            ? new Date(content.endTime).toISOString()
            : undefined,
          startOffsetMs: content.startOffsetMs,
          endOffsetMs: content.endOffsetMs,
          children: content.children,
          speakerName: content.speakerName,
          speakerIdentifier: content.speakerIdentifier,
        };
      }),
    };
  });
};
