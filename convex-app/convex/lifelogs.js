import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const metadataGet = query({
  handler: async ({ db }) => {
    return await db.query("metadata").collect();
  },
});

export const get = query({
  args: {
    limit: v.optional(v.number()),
    start_date: v.optional(v.number()), // Unix timestamp
    end_date: v.optional(v.number())    // Unix timestamp
  },
  handler: async ({ db }, { limit, start_date, end_date }) => {
    let query = db.query("lifelogs");
    
    if (start_date) {
      query = query.filter(q => q.gte(q.field("timestamp"), start_date));
    }
    
    if (end_date) {
      query = query.filter(q => q.lte(q.field("timestamp"), end_date));
    }
    
    if (limit) {
      return await query.take(limit).collect();
    }
    
    return await query.collect();
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
    // Simply insert the lifelog with its timestamp
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
    const metadataTable = await ctx.db.query("metadata").collect();
    if (metadataTable.length === 0) {
      const defaultMetadata = {
        localSyncTime: new Date().toISOString(),
        localLogCount: 0,
        cloudSyncTime: new Date().toISOString(),
        cloudLogCount: 0
      }
      await ctx.db.insert("metadata", defaultMetadata);
    }
    const metadata = metadataTable[0];

    // Determine timestamp
    let timestamp;
    
    if (lifelog.timestamp !== undefined) {
      // Use the directly provided timestamp
      timestamp = lifelog.timestamp;
    } else if (lifelog.contents.length > 0 && lifelog.contents[0].startTime) {
      // Use the first content item's startTime
      const parsedTime = new Date(lifelog.contents[0].startTime).getTime();
      
      // Only use the parsed time if it's valid
      if (!isNaN(parsedTime)) {
        timestamp = parsedTime;
      } else {
        // Fallback to current time if parsing fails
        timestamp = Date.now();
      }
    } else {
      // No timestamp provided and no startTime in first content - use current time
      timestamp = Date.now();
    }
    
    // Prepare lifelog for core insertion
    const lifelogToInsert = { ...lifelog };
    
    // Remove the timestamp from the object copy if it was in the input
    if ('timestamp' in lifelogToInsert) {
      delete lifelogToInsert.timestamp;
    }
    
    // Ensure each content item has a children array
    const contentsWithChildren = lifelogToInsert.contents.map(item => ({
      ...item,
      children: item.children || [] // Set empty array if children is missing
    }));
    
    // Call the core mutation to insert the lifelog
    await ctx.runMutation(internal.lifelogs.addLifelogCore, {
      lifelog: {
        ...lifelogToInsert,
        contents: contentsWithChildren,
        timestamp
      }
    });
    
    // Update the metadata table
    await ctx.db.patch(metadata._id, {
      cloudSyncTime: new Date().toISOString(),
      cloudLogCount: metadata.cloudLogCount + 1,
      localSyncTime: metadata.localSyncTime,
      localLogCount: metadata.localLogCount,
      ids: [...metadata.ids, lifelog.id]
      // remember to have assertions about the ids array.
    });
  }
});

// Get lifelogs within a specific time range
export const getLifelogsByTimeRange = query({
  args: {
    start: v.number(), // Unix timestamp
    end: v.number(),   // Unix timestamp
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
    const { start, end, limit = 20, cursor, direction = "desc" } = args;

    const lifelogs = await ctx.db
      .query("lifelogs")
      .withIndex("by_timestamp", (q) =>
        q
          .gt("timestamp", start)
          .lt("timestamp", end)
      )
      .order(direction)
      .paginate({ cursor, numItems: limit });

    return lifelogs;
  }
});

// Get lifelogs for a specific date (in a given timezone)
export const getLifelogsByDate = query({
  args: {
    date: v.string(), // YYYY-MM-DD
    timezone: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
    const { date, timezone, limit = 20, cursor, direction = "desc" } = args;
    
    // Convert date to start and end timestamps in the given timezone
    const start = new Date(`${date}T00:00:00`).getTime();
    const end = new Date(`${date}T23:59:59.999`).getTime();

    const lifelogs = await ctx.db
      .query("lifelogs")
      .withIndex("by_timestamp", (q) =>
        q
          .gt("timestamp", start)
          .lt("timestamp", end)
      )
      .order(direction)
      .paginate({ cursor, numItems: limit });

    return lifelogs;
  }
});

// Get latest lifelogs (for paginated feed)
export const getLatestLifelogs = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { limit = 20, cursor } = args;

    const lifelogs = await ctx.db
      .query("lifelogs")
      .withIndex("by_timestamp")
      .order("desc")
      .paginate({ cursor, numItems: limit });

    return lifelogs;
  }
});

// Get a single lifelog by ID
export const getLifelogById = query({
  args: {
    id: v.string(),
  },
  handler: async (ctx, args) => {
    const lifelog = await ctx.db
      .query("lifelogs")
      .filter((q) => q.eq(q.field("id"), args.id))
      .unique();

    return lifelog;
  }
});

// Search lifelogs by title
export const searchLifelogs = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { query, limit = 20, cursor } = args;

    const lifelogs = await ctx.db
      .query("lifelogs")
      .withSearchIndex("search_title_content", (q) =>
        q.search("title", query)
      )
      .paginate({ cursor, numItems: limit });

    return lifelogs;
  }
});
