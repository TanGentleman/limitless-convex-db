// This file defines the CRUD operations for the lifelogs table
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

import { seedMetadata } from "./sampleData/seeds";

// CREATE
// Add a new meta entry
export const create = internalMutation({
  args: {
    meta: v.object({
      startTime: v.number(),
      endTime: v.number(),
      syncedUntil: v.number(),
      lifelogIds: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const meta = args.meta;
    await ctx.db.insert("metadata", meta);
  },
});

export const createDefaultMeta = internalMutation({
  handler: async (ctx) => {
    // Make sure there is no existing metadata
    const existingMetadata = await ctx.db.query("metadata").take(1);
    if (existingMetadata.length > 0) {
      console.log("Metadata already exists, skipping creation");
      // Could return ID of existing metadata
      return null;
    }
    return await ctx.db.insert("metadata", seedMetadata);
  },
});


// READ
// Get the latest meta entry
export const getLatest = internalQuery({
  handler: async (ctx) => {
    const meta = await ctx.db.query("metadata").take(1);
    return meta;
  },
});
