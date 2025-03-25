// This file defines functions for logging operations in the database
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

// CREATE
// Log a new operation
export const create = internalMutation({
  args: {
    operations: v.array(v.object({
      operation: v.union(
        v.literal("sync"), 
        v.literal("create"), 
        v.literal("read"), 
        v.literal("update"), 
        v.literal("delete")
      ),
      table: v.union(
        v.literal("lifelogs"), 
        v.literal("metadata"), 
        v.literal("markdownEmbeddings")
      ),
      success: v.boolean(),
      data: v.object({
        message: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    })),
  },
  handler: async (ctx, args) => {
    for (const operation of args.operations) {
      await ctx.db.insert("operations", operation);
    }
  },
});

// Helper functions for common operations
export const logSync = internalMutation({
  args: {
    success: v.boolean(),
    data: v.object({
      message: v.optional(v.string()),
      error: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("operations", {
      operation: "sync",
      table: "lifelogs",
      success: args.success,
      data: args.data,
    });
  },
});

// READ
// Get recent operation logs
export const getRecentLogs = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("operations")
      .order("desc")
      .take(limit);
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
