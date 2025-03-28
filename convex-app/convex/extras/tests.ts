import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, } from "../_generated/server";
import { lifelogOperation, metadataOperation } from "./utils";
import { Id } from "../_generated/dataModel";
import { seedMetadata } from "../sampleData/seeds";

const defaultLimit = 1;

export const deleteMetadataDocs = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const isDryRun = args.dryRun ?? false;
    const limit = args.limit ?? defaultLimit;
    
    // Get the most recent metadata docs
    const recentMetadata = await ctx.db.query("metadata").order("desc").take(limit);
    
    // Collect metadata IDs for reporting
    const metadataIds = recentMetadata.map(doc => doc._id);
    
    if (!isDryRun && metadataIds.length > 0) {
      // Delete the metadata docs
      for (const id of metadataIds) {
        await ctx.db.delete(id);
        
        // Log the deletion operation
        const operation = metadataOperation("delete", `Deleted metadata entry ${id}`);
        await ctx.runMutation(internal.operations.createDocs, {
          operations: [operation],
        });
      }
    }
    
    return {
      deletedMetadata: isDryRun ? 0 : metadataIds.length,
      metadataIds: metadataIds,
      dryRun: isDryRun
    };
  },
});

export const deleteRecentLifelogs = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const isDryRun = args.dryRun ?? false;
    const limit = args.limit ?? defaultLimit;
    
    // Get the most recent lifelogs
    const recentLifelogs = await ctx.db.query("lifelogs").order("desc").take(limit);
    
    // Collect lifelog IDs for reporting
    const lifelogIds: Id<"lifelogs">[] = [];
    
    if (!isDryRun) {
      // Delete associated markdown embeddings and lifelogs
      for (const lifelog of recentLifelogs) {
        lifelogIds.push(lifelog._id);
        
        // Delete embedding if it exists
        if (lifelog.embeddingId !== null) {
          await ctx.db.delete(lifelog.embeddingId);
        }
        
        // Log the deletion operation
        const operation = lifelogOperation(
          "delete", 
          `Deleted lifelog ${lifelog._id} (${lifelog.title})`
        );
        await ctx.runMutation(internal.operations.createDocs, {
          operations: [operation],
        });
        
        // Delete the lifelog itself
        await ctx.db.delete(lifelog._id);
      }
    } else {
      // Just collect IDs for dry run
      for (const lifelog of recentLifelogs) {
        lifelogIds.push(lifelog._id);
      }
    }
    
    return {
      deletedLifelogs: isDryRun ? 0 : lifelogIds.length,
      lifelogIds: lifelogIds,
      dryRun: isDryRun
    };
  },
});

export const getMetadataDoc = internalMutation({
  handler: async (ctx) => {
    const existingMetadata = await ctx.db.query("metadata").order("desc").take(1);
    
    if (existingMetadata.length > 0) {
      return existingMetadata[0];
    }
    
    // Create default metadata if none exists
    const id = await ctx.db.insert("metadata", seedMetadata);
    const result = await ctx.db.get(id);
    if (result === null) {
      throw new Error("Failed to create default metadata");
    }
    return result;
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
