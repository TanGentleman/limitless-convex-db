// This file defines the CRUD operations for the metadata table
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { metadataDoc } from "./types";
import { seedMetadata } from "./sampleData/seeds";
import { internal } from "./_generated/api";
import { metadataOperation } from "./extras/utils";
// CREATE
export const create = internalMutation({
  args: {
    meta: metadataDoc,
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("metadata", args.meta);
    
    const operation = metadataOperation("create", "Created new metadata entry");
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return id;
  },
});

export const createDefaultMeta = internalMutation({
  handler: async (ctx) => {
    const existingMetadata = await ctx.db.query("metadata").take(1);
    if (existingMetadata.length > 0) {
      console.log("Metadata already exists, skipping creation");
      return null;
    }
    
    const id = await ctx.runMutation(internal.metadata.create, {
      meta: seedMetadata
    });
    
    return id;
  },
});

// READ
export const readLatest = internalQuery({
  handler: async (ctx) => {
    return await ctx.db.query("metadata").order("desc").take(1);
  },
});

export const read = internalQuery({
  args: {
    id: v.id("metadata"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const readAll = internalQuery({
  handler: async (ctx) => {
    return await ctx.db.query("metadata").collect();
  },
});

// UPDATE
export const update = internalMutation({
  args: {
    id: v.id("metadata"),
    metadata: v.object({
      startTime: v.optional(v.number()),
      endTime: v.optional(v.number()),
      syncedUntil: v.optional(v.number()),
      lifelogIds: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const existingMetadata = await ctx.db.get(args.id);
    if (!existingMetadata) {
      throw new Error(`Metadata with ID ${args.id} not found`);
    }
    
    await ctx.db.patch(args.id, args.metadata);
    
    const operation = metadataOperation("update", `Updated metadata entry ${args.id}`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return args.id;
  },
});

// DELETE
export const deleteMetadata = internalMutation({
  args: {
    id: v.id("metadata"),
  },
  handler: async (ctx, args) => {
    const existingMetadata = await ctx.db.get(args.id);
    if (!existingMetadata) {
      throw new Error(`Metadata with ID ${args.id} not found`);
    }
    
    await ctx.db.delete(args.id);
    
    const operation = metadataOperation("delete", `Deleted metadata entry ${args.id}`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return args.id;
  },
});

export const deleteAll = internalMutation({
  handler: async (ctx) => {
    const metadataEntries = await ctx.db.query("metadata").collect();
    
    for (const entry of metadataEntries) {
      await ctx.db.delete(entry._id);
    }
    
    const operation = metadataOperation("delete", `Deleted all ${metadataEntries.length} metadata entries`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return { count: metadataEntries.length };
  },
});
