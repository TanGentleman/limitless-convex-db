// This file defines functions for logging operations in the database
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { operationsDoc } from "./types";

// CREATE
// Log a new operation
export const create = internalMutation({
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
export const readAll = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const queryBatch = await ctx.db
      .query("operations")
      .order("desc")
    if (args.limit === undefined) {
      return queryBatch.collect();
    } else {
      return queryBatch.take(args.limit);
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

// Get logs by operation type
export const getLogsByOperation = internalQuery({
  args: {
    operation: v.union(
      v.literal("sync"), 
      v.literal("create"), 
      v.literal("read"), 
      v.literal("update"), 
      v.literal("delete")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("operations")
      .filter(q => q.eq(q.field("operation"), args.operation))
      .order("desc")
      .take(limit);
  },
});

// Get logs by table
export const getLogsByTable = internalQuery({
  args: {
    table: v.union(
      v.literal("lifelogs"), 
      v.literal("metadata"), 
      v.literal("markdownEmbeddings")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("operations")
      .filter(q => q.eq(q.field("table"), args.table))
      .order("desc")
      .take(limit);
  },
});

// Get failed operations
export const getFailedOperations = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("operations")
      .filter(q => q.eq(q.field("success"), false))
      .order("desc")
      .take(limit);
  },
});
