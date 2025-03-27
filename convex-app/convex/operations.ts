// This file defines functions for logging operations in the database
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { operationsDoc } from "./types";

// CREATE
// Log a new operation
export const createDocs = internalMutation({
  args: {
    operations: v.array(operationsDoc),
  },
  handler: async (ctx, args) => {
    for (const operation of args.operations) {
      await ctx.db.insert("operations", operation);
    }
  },
});

// READ
// Get recent operation logs
export const readDocs = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const queryBatch = ctx.db
      .query("operations")
      .order("desc")
    if (args.limit === undefined) {
      return queryBatch.collect();
    } else {
      return await queryBatch.take(args.limit);
    }
  },
});

// UPDATE
// Update an operation
export const update = internalMutation({
  args: {
    id: v.id("operations"),
    operation: operationsDoc,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.operation);
  },
});

// DELETE
// Delete an operation
export const deleteDocs = internalMutation({
  args: {
    ids: v.array(v.id("operations")),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
  },
});
