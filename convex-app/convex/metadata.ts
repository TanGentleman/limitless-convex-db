// This file defines the CRUD operations for the metadata table
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { metadataDoc } from "./types";
import { internal } from "./_generated/api";
import { metadataOperation } from "./extras/utils";
import { Doc, Id } from "./_generated/dataModel";

// CREATE
export const createDocs = internalMutation({
  args: {
    metadataDocs: v.array(metadataDoc),
  },
  handler: async (ctx, args) => {
    const ids: Id<"metadata">[] = [];
    
    for (const metadataDoc of args.metadataDocs) {
      const id = await ctx.db.insert("metadata", metadataDoc);
      ids.push(id);
    }
    
    const operation = metadataOperation("create", `Created ${ids.length} metadata entries`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return ids;
  },
});

// READ
export const readDocs = internalQuery({
  args: {
    ids: v.optional(v.array(v.id("metadata"))),
    latest: v.optional(v.boolean()),
    all: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Get by IDs
    if (args.ids && args.ids.length > 0) {
      const docs: Doc<"metadata">[] = [];
      for (const id of args.ids) {
        const doc = await ctx.db.get(id);
        if (doc !== null) {
          docs.push(doc);
        }
      }
      return docs;
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
export const updateDocs = internalMutation({
  args: {
    updates: v.array(v.object({
      id: v.id("metadata"),
      metadata: metadataDoc,
    })),
  },
  handler: async (ctx, args) => {
    const updatedIds: Id<"metadata">[] = [];
    
    for (const update of args.updates) {
      const existingMetadata = await ctx.db.get(update.id);
      if (!existingMetadata) {
        throw new Error(`Metadata with ID ${update.id} not found`);
      }
      
      await ctx.db.patch(update.id, update.metadata);
      updatedIds.push(update.id);
    }
    
    const operation = metadataOperation("update", `Updated ${updatedIds.length} metadata entries`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return updatedIds;
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
    }
    
    const operation = metadataOperation("delete", `Deleted ${args.ids.length} metadata entries`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return args.ids;
  },
});
