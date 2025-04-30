// This file defines the CRUD operations for the metadata table
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { metadataDoc } from "./types";
import { metadataOperation } from "./extras/utils";
import { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

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

    const operation = metadataOperation(
      "create",
      `Created ${ids.length} metadata entries`,
    );
    await ctx.db.insert("operations", operation);
    return ids;
  },
});

// READ
export const readDocsById = internalQuery({
  args: {
    ids: v.array(v.id("metadata")),
  },
  handler: async (ctx, args) => {
    const docs: Doc<"metadata">[] = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc === null) {
        console.log(`Metadata with ID ${id} not found`);
        continue;
      }
      docs.push(doc);
    }
    return docs;
  },
});

export const readDocs = internalQuery({
  args: {
    limit: v.optional(v.number()),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 1;
    const direction = args.direction ?? "desc";

    // Query with specified limit and direction
    return await ctx.db.query("metadata").order(direction).take(limit);
  },
});

// UPDATE
export const updateDocs = internalMutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("metadata"),
        metadata: metadataDoc,
      }),
    ),
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

    const operation = metadataOperation(
      "update",
      `Updated ${updatedIds.length} metadata entries`,
    );
    await ctx.db.insert("operations", operation);

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

    const operation = metadataOperation(
      "delete",
      `Deleted ${args.ids.length} metadata entries`,
    );
    await ctx.db.insert("operations", operation);

    return args.ids;
  },
});
