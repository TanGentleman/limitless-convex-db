// This file defines functions for logging operations in the database
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { operationsDoc } from "./types";

const defaultLimit = 1;

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
// Set limit to null to get all
export const readDocs = internalQuery({
  args: {
    limit: v.optional(v.union(v.number(), v.null())),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
    const limit = args.limit !== undefined ? args.limit : defaultLimit;
    const direction = args.direction || "desc";
    const queryBatch = ctx.db
      .query("operations")
      .order(direction);
    if (limit === null) {
      return queryBatch.collect();
    } 
    else {
      return await queryBatch.take(limit);
    }
  },
});

// UPDATE
// Update an operation
export const update = internalMutation({
  args: {
    updates: v.array(v.object({
      id: v.id("operations"),
      operation: operationsDoc,
    })),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      await ctx.db.patch(update.id, update.operation);
    }
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
