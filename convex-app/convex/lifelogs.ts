import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

const DEFAULT_FETCH_LIMIT = 1;

// Types that match our schema
type ContentNode = {
  type: "heading1" | "heading2" | "blockquote";
  content: string;
  startTime?: string;
  endTime?: string;
  startOffsetMs?: number;
  endOffsetMs?: number;
  children?: ContentNode[];
  speakerName?: string | null;
  speakerIdentifier?: "user" | null;
};

type LifelogInput = {
  id: string;
  title: string;
  markdown: string | null;
  startTime?: string;
  endTime?: string;
  contents: ContentNode[];
};

type Metadata = {
  _id: Id<"metadata">;
  localSyncTime: string;
  localLogCount: number;
  cloudSyncTime: string;
  cloudLogCount: number;
  ids: string[];
};

// ==================== VALIDATION SCHEMAS ====================

// Content node validation schema
const contentNodeSchema = v.object({
  content: v.string(),
  type: v.union(v.literal("heading1"), v.literal("heading2"), v.literal("blockquote")),
  speakerName: v.optional(v.string()),
  startTime: v.optional(v.string()),
  endTime: v.optional(v.string()),
  startOffsetMs: v.optional(v.number()),
  endOffsetMs: v.optional(v.number()),
  children: v.optional(v.array(v.any())),
  speakerIdentifier: v.optional(v.union(v.literal("user"), v.null()))
});

// Lifelog input schema
const lifelogInputSchema = v.object({
  id: v.string(),
  title: v.string(),
  markdown: v.string(),
  timestamp: v.optional(v.number()),
  contents: v.array(contentNodeSchema)
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Ensures metadata exists and returns it.
 * Creates default metadata if none exists.
 */
async function ensureMetadata(db): Promise<Metadata> {
  const metadata = await db.query("metadata").first();
  
  if (metadata) {
    return metadata as Metadata;
  }
  
  const defaultMetadata = {
    localSyncTime: new Date().toISOString(),
    localLogCount: 0,
    cloudSyncTime: new Date().toISOString(),
    cloudLogCount: 0,
    ids: []
  };
  
  const metadataId = await db.insert("metadata", defaultMetadata);
  return { _id: metadataId, ...defaultMetadata };
}

/**
 * Determines the timestamp for a lifelog with fallback logic:
 * 1. Use provided timestamp if available
 * 2. Extract from first content item's startTime
 * 3. Fallback to current time
 */
function determineTimestamp(lifelog: LifelogInput): number {
  if (lifelog.timestamp !== undefined) {
    return lifelog.timestamp;
  } 
  
  if (lifelog.contents.length > 0 && lifelog.contents[0].startTime) {
    const parsedTime = new Date(lifelog.contents[0].startTime).getTime();
    if (!isNaN(parsedTime)) {
      return parsedTime;
    }
  }
  
  console.log("Timestamp error: Using current time");
  return Date.now();
}

/**
 * Parses timezone string and returns offset.
 * Returns 'Z' (UTC) if the timezone is not in the format +/-HH:MM
 */
function getTimezoneOffset(timezone: string): string {
  return timezone.match(/^[+-]\d{2}:\d{2}$/) ? timezone : 'Z'; // Default to UTC
}

// ==================== METADATA OPERATIONS ====================

export const metadataGet = query({
  handler: async ({ db }) => {
    return await db.query("metadata").first();
  },
});

// ==================== BASIC QUERIES ====================

export const get = query({
  args: {
    limit: v.optional(v.number()),
    start_date: v.optional(v.number()), // Unix timestamp
    end_date: v.optional(v.number())    // Unix timestamp
  },
  handler: async ({ db }, { limit = DEFAULT_FETCH_LIMIT, start_date, end_date }) => {
    let lifelogQuery = db.query("lifelogs").withIndex("by_timestamp").order("desc");
    
    if (start_date) {
      lifelogQuery = lifelogQuery.filter(q => q.gte(q.field("timestamp"), start_date));
    }
    
    if (end_date) {
      lifelogQuery = lifelogQuery.filter(q => q.lte(q.field("timestamp"), end_date));
    }
    
    return limit ? await lifelogQuery.take(limit) : await lifelogQuery.collect();
  }
});

export const getLifelogById = query({
  args: {
    id: v.string(),
  },
  handler: async ({ db }, { id }) => {
    return await db
      .query("lifelogs")
      .filter((q) => q.eq(q.field("id"), id))
      .unique();
  }
});

// ==================== TIME-BASED QUERIES ====================

export const getLifelogsByTimeRange = query({
  args: {
    start: v.number(), // Unix timestamp
    end: v.number(),   // Unix timestamp
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async ({ db }, { start, end, limit = DEFAULT_FETCH_LIMIT, cursor = null, direction = "desc" }) => {
    return await db
      .query("lifelogs")
      .withIndex("by_timestamp", (q) => q.gt("timestamp", start).lt("timestamp", end))
      .order(direction)
      .paginate({ cursor, numItems: limit });
  }
});

export const getLifelogsByDate = query({
  args: {
    date: v.string(), // YYYY-MM-DD
    timezone: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async ({ db }, { date, timezone, limit = DEFAULT_FETCH_LIMIT, cursor = null, direction = "desc" }) => {
    const tzOffset = getTimezoneOffset(timezone);
    const startDate = new Date(`${date}T00:00:00${tzOffset}`).getTime();
    const endDate = new Date(`${date}T23:59:59.999${tzOffset}`).getTime();

    return await db
      .query("lifelogs")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", startDate).lte("timestamp", endDate))
      .order(direction)
      .paginate({ cursor, numItems: limit });
  }
});

// ==================== FEED AND SEARCH QUERIES ====================

export const getLatestLifelogs = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async ({ db }, { limit = DEFAULT_FETCH_LIMIT, cursor = null }) => {
    return await db
      .query("lifelogs")
      .withIndex("by_timestamp")
      .order("desc")
      .paginate({ cursor, numItems: limit });
  }
});

export const searchLifelogs = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async ({ db }, { query, limit = DEFAULT_FETCH_LIMIT, cursor = null }) => {
    if (!query.trim()) {
      return { page: [], continueCursor: null };
    }

    return await db
      .query("lifelogs")
      .withSearchIndex("search_title_content", (q) => q.search("title", query))
      .paginate({ cursor, numItems: limit });
  }
});

// ==================== MUTATION OPERATIONS ====================

// Add a single lifelog
export const add = mutation({
  args: {
    lifelog: lifelogInputSchema
  },
  handler: async ({ db }, { lifelog }) => {
    const metadata = await ensureMetadata(db);
    
    const lifelogToInsert = {
      ...lifelog,
      timestamp: determineTimestamp(lifelog)
    };
    
    const lifelogId = await db.insert("lifelogs", lifelogToInsert);
    
    await db.patch(metadata._id, {
      cloudSyncTime: new Date().toISOString(),
      cloudLogCount: (metadata.cloudLogCount || 0) + 1,
      ids: [...(metadata.ids || []), lifelog.id]
    });
    
    return { id: lifelogId };
  }
});

// Batch add mutation for efficiently handling multiple lifelogs
export const batchAdd = mutation({
  args: {
    lifelogs: v.array(lifelogInputSchema)
  },
  handler: async ({ db }, { lifelogs }) => {
    if (lifelogs.length === 0) {
      return { inserted: 0, skipped: 0 };
    }
    
    const metadata = await ensureMetadata(db);
    const existingIds = metadata.ids || [];
    
    const newLogs = lifelogs.filter(log => !existingIds.includes(log.id));
    const skippedCount = lifelogs.length - newLogs.length;
    
    const insertedIds: Id<"lifelogs">[] = [];
    for (const log of newLogs) {
      const id = await db.insert("lifelogs", {
        ...log,
        timestamp: determineTimestamp(log)
      });
      insertedIds.push(id);
    }
    
    if (insertedIds.length > 0) {
      await db.patch(metadata._id, {
        cloudSyncTime: new Date().toISOString(),
        cloudLogCount: (metadata.cloudLogCount || 0) + insertedIds.length,
        ids: [...existingIds, ...newLogs.map(log => log.id)]
      });
    }
    
    return {
      inserted: insertedIds.length,
      skipped: skippedCount,
      ids: insertedIds
    };
  }
});