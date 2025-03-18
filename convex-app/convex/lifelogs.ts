import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

const defaultFetchLimit = 1;

// Types that match our schema
type ContentItem = {
  type: "heading1" | "heading2" | "blockquote";
  content: string;
  startTime?: string;
  endTime?: string;
  startOffsetMs?: number;
  endOffsetMs?: number;
  children?: any[];
  speakerName?: string;
  speakerIdentifier?: "user" | null;
};

type LifelogInput = {
  id: string;
  title: string;
  markdown: string;
  timestamp?: number;
  contents: ContentItem[];
};

// Metadata queries
export const metadataGet = query({
  handler: async ({ db }) => {
    return await db.query("metadata").take(1);
  },
});

// Basic lifelog queries
export const get = query({
  args: {
    limit: v.optional(v.number()),
    start_date: v.optional(v.number()), // Unix timestamp
    end_date: v.optional(v.number())    // Unix timestamp
  },
  handler: async ({ db }, { limit = defaultFetchLimit, start_date, end_date }) => {
    // Start with the index and order first
    let lifelogQuery = db.query("lifelogs").withIndex("by_timestamp").order("desc");
    
    // Then apply filters
    if (start_date) {
      lifelogQuery = lifelogQuery.filter(q => q.gte(q.field("timestamp"), start_date));
    }
    
    if (end_date) {
      lifelogQuery = lifelogQuery.filter(q => q.lte(q.field("timestamp"), end_date));
    }
    
    if (limit) {
      return await lifelogQuery.take(limit);
    }
    
    return await lifelogQuery.collect();
  }
});

// Core mutation that adds a lifelog with required timestamp
export const addLifelogCore = mutation({
  args: {
    lifelog: v.object({
      id: v.string(),
      title: v.string(),
      markdown: v.string(),
      timestamp: v.number(), // Required timestamp
      contents: v.array(v.object({
        content: v.string(),
        type: v.union(v.literal("heading1"), v.literal("heading2"), v.literal("blockquote")),
        speakerName: v.optional(v.string()),
        startTime: v.optional(v.string()),
        endTime: v.optional(v.string()),
        startOffsetMs: v.optional(v.number()),
        endOffsetMs: v.optional(v.number()),
        children: v.array(v.any()),
        speakerIdentifier: v.optional(v.union(v.literal("user"), v.null()))
      }))
    })
  },
  handler: async ({ db }, { lifelog }) => {
    return await db.insert("lifelogs", lifelog);
  }
});

// Wrapper mutation that handles optional fields and metadata updates
export const add = mutation({
  args: {
    lifelog: v.object({
      id: v.string(),
      title: v.string(),
      markdown: v.string(),
      timestamp: v.optional(v.number()), // Optional direct timestamp input
      contents: v.array(v.object({
        content: v.string(),
        type: v.union(v.literal("heading1"), v.literal("heading2"), v.literal("blockquote")),
        speakerName: v.optional(v.string()),
        startTime: v.optional(v.string()),
        endTime: v.optional(v.string()),
        startOffsetMs: v.optional(v.number()),
        endOffsetMs: v.optional(v.number()),
        children: v.optional(v.array(v.any())), // Optional children
        speakerIdentifier: v.optional(v.union(v.literal("user"), v.null()))
      }))
    })
  },
  handler: async (ctx, { lifelog }) => {
    // Ensure metadata exists or create it
    const metadataTable = await ctx.db.query("metadata").collect();
    let metadataId: Id<"metadata">;
    
    if (metadataTable.length === 0) {
      const defaultMetadata = {
        localSyncTime: new Date().toISOString(),
        localLogCount: 0,
        cloudSyncTime: new Date().toISOString(),
        cloudLogCount: 0,
        ids: []
      };
      metadataId = await ctx.db.insert("metadata", defaultMetadata);
    } else {
      metadataId = metadataTable[0]._id;
    }

    // Determine timestamp with proper fallback logic
    const timestamp = determineTimestamp(lifelog);
    
    // Prepare lifelog for insertion
    const lifelogToInsert: LifelogInput = {
      id: lifelog.id,
      title: lifelog.title,
      markdown: lifelog.markdown,
      contents: lifelog.contents,
      timestamp
    };
    
    // Insert the lifelog
    await ctx.db.insert("lifelogs", lifelogToInsert);
    
    // Update metadata
    await ctx.db.patch(metadataId, {
      cloudSyncTime: new Date().toISOString(),
      cloudLogCount: (metadataTable[0]?.cloudLogCount || 0) + 1,
      ids: [...(metadataTable[0]?.ids || []), lifelog.id]
    });
  }
});

// Helper function to determine timestamp - extracted for clarity
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

// Time-based query functions
export const getLifelogsByTimeRange = query({
  args: {
    start: v.number(), // Unix timestamp
    end: v.number(),   // Unix timestamp
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
    const { start, end, limit = 20, cursor = null, direction = "desc" } = args;

    return await ctx.db
      .query("lifelogs")
      .withIndex("by_timestamp", (q) =>
        q
          .gt("timestamp", start)
          .lt("timestamp", end)
      )
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
  handler: async (ctx, args) => {
    const { date, timezone, limit = 20, cursor = null, direction = "desc" } = args;
    
    // Convert date to start and end timestamps in the given timezone
    // Note: For proper timezone support, we would need a more robust solution
    // This is a simplified version
    const startDate = new Date(`${date}T00:00:00${getTimezoneOffset(timezone)}`);
    const endDate = new Date(`${date}T23:59:59.999${getTimezoneOffset(timezone)}`);
    
    const start = startDate.getTime();
    const end = endDate.getTime();

    return await ctx.db
      .query("lifelogs")
      .withIndex("by_timestamp", (q) =>
        q
          .gte("timestamp", start)
          .lte("timestamp", end)
      )
      .order(direction)
      .paginate({ cursor, numItems: limit });
  }
});

// Helper function for timezone handling
function getTimezoneOffset(timezone: string): string {
  // Simple implementation - in production, you'd use a proper timezone library
  // This just handles basic +HH:MM or -HH:MM formats
  if (timezone.match(/^[+-]\d{2}:\d{2}$/)) {
    return timezone;
  }
  return 'Z'; // Default to UTC
}

// Feed and search queries
export const getLatestLifelogs = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { limit = 20, cursor = null } = args;

    return await ctx.db
      .query("lifelogs")
      .withIndex("by_timestamp")
      .order("desc")
      .paginate({ cursor, numItems: limit });
  }
});

export const getLifelogById = query({
  args: {
    id: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("lifelogs")
      .filter((q) => q.eq(q.field("id"), args.id))
      .unique();
  }
});

export const searchLifelogs = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { query, limit = 20, cursor = null } = args;

    if (!query.trim()) {
      throw new Error("Query is empty");
    }

    return await ctx.db
      .query("lifelogs")
      .withSearchIndex("search_title_content", (q) =>
        q.search("title", query)
      )
      .paginate({ cursor, numItems: limit });
  }
});

// Batch add mutation that efficiently handles multiple lifelogs
export const batchAdd = mutation({
  args: {
    lifelogs: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        markdown: v.string(),
        timestamp: v.optional(v.number()),
        contents: v.array(v.object({
          content: v.string(),
          type: v.union(v.literal("heading1"), v.literal("heading2"), v.literal("blockquote")),
          speakerName: v.optional(v.string()),
          startTime: v.optional(v.string()),
          endTime: v.optional(v.string()),
          startOffsetMs: v.optional(v.number()),
          endOffsetMs: v.optional(v.number()),
          children: v.optional(v.array(v.any())),
          speakerIdentifier: v.optional(v.union(v.literal("user"), v.null()))
        }))
      })
    )
  },
  handler: async (ctx, { lifelogs }) => {
    // Early exit if no lifelogs provided
    if (lifelogs.length === 0) {
      return { inserted: 0, skipped: 0 };
    }
    
    // Get metadata once to check existing IDs
    const metadataTable = await ctx.db.query("metadata").take(1);
    let metadataId: Id<"metadata">;
    let existingIds: string[] = [];
    
    if (metadataTable.length === 0) {
      const defaultMetadata = {
        localSyncTime: new Date().toISOString(),
        localLogCount: 0,
        cloudSyncTime: new Date().toISOString(),
        cloudLogCount: 0,
        ids: []
      };
      metadataId = await ctx.db.insert("metadata", defaultMetadata);
      console.log("Metadata created");
    } else {
      metadataId = metadataTable[0]._id;
      existingIds = metadataTable[0].ids || [];
    }

    // Filter out duplicates based on ID
    const newLogs = lifelogs.filter(log => !existingIds.includes(log.id));
    const skippedCount = lifelogs.length - newLogs.length;
    
    // Process and insert each new lifelog sequentially
    let insertedCount = 0;
    for (const lifelog of newLogs) {
      // Add timestamp using the same logic as single add
      const timestamp = determineTimestamp(lifelog);
      
      // Prepare lifelog with proper structure
      const lifelogToInsert: LifelogInput = {
        id: lifelog.id,
        title: lifelog.title,
        markdown: lifelog.markdown,
        contents: lifelog.contents,
        timestamp
      };
      
      // Insert one at a time
      await ctx.db.insert("lifelogs", lifelogToInsert);
      insertedCount++;
    }
    
    // Update metadata once at the end
    if (newLogs.length > 0) {
      const newIds = [...existingIds, ...newLogs.map(log => log.id)];
      await ctx.db.patch(metadataId, {
        cloudSyncTime: new Date().toISOString(),
        cloudLogCount: (metadataTable[0]?.cloudLogCount || 0) + newLogs.length,
        ids: newIds
      });
    }
    
    // Return stats for the operation
    return {
      inserted: insertedCount,
      skipped: skippedCount
    };
  }
}); 