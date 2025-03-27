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

// READ
export const readDocs = internalQuery({
  args: {
    id: v.optional(v.id("metadata")),
    latest: v.optional(v.boolean()),
    all: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Get by ID
    if (args.id) {
      const singleDoc = await ctx.db.get(args.id);
      return singleDoc ? [singleDoc] : [];
    }
    
    // Get latest entry
    if (args.latest) {
      return await ctx.db.query("metadata").order("desc").take(1);
    }
    
    // Get all entries
    if (args.all) {
      return await ctx.db.query("metadata").collect();
    }
    
    // Default to latest if no args specified
    return await ctx.db.query("metadata").order("desc").take(1);
  },
});

// UPDATE
export const update = internalMutation({
  args: {
    id: v.id("metadata"),
    metadata: metadataDoc,
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
export const deleteDocs = internalMutation({
  args: {
    ids: v.array(v.id("metadata")),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const existingMetadata = await ctx.db.get(id);
      if (!existingMetadata) {
        throw new Error(`Metadata with ID ${id} not found`);
      }
    
      await ctx.db.delete(id);
      
      const operation = metadataOperation("delete", `Deleted metadata entry ${id}`);
      await ctx.runMutation(internal.operations.createDocs, {
        operations: [operation],
      });
    }
    
    return args.ids;
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
