import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { operationsDoc } from "../types";
const defaultLimit = 1000;

// Helper functions to make timestamps human readable
// Use os.env.TIMEZONE to get the timezone
// Wrapper function for date formatting
export const formatDate = (date: Date | number | string, timezone?: string): string => {
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    timeZone: timezone || process.env.TIMEZONE || 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

// Generic operation creation helper
const createOperation = (
  operation:"sync" | "create" | "read" | "update" | "delete",
  table: "lifelogs" | "metadata" | "markdownEmbeddings",
  success: boolean,
  data: { message?: string; error?: string }
) => ({
  operation,
  table,
  success,
  data: !success && !data.error && data.message ? { error: data.message } : data
});

// Simplified metadata operation creator
export const metadataOperation = (
  operation: "create" | "update" | "delete" | "sync",
  message: string,
  success: boolean = true,
) => {
  return createOperation(operation, "metadata", success, { message });
};

const lifelogOperation = (
  operation: "create" | "read" | "update" | "delete",
  message: string,
  success: boolean = true
) => {
  return createOperation(operation, "lifelogs", success, { message });
};




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
      const limit = args.limit ?? defaultLimit;
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
      const limit = args.limit ?? defaultLimit;
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
      const limit = args.limit ?? defaultLimit;
      return await ctx.db
        .query("operations")
        .filter(q => q.eq(q.field("success"), false))
        .order("desc")
        .take(limit);
    },
  });
