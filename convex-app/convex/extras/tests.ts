import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, } from "../_generated/server";
import { lifelogOperation, metadataOperation } from "./utils";
import { Id } from "../_generated/dataModel";
import { seedMetadata } from "./utils";

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

/**
 * Deletes ALL lifelog documents and their associated markdown embeddings. 
 * Use with caution as this operation is irreversible.
 * 
 * @param destructive - Must be explicitly set to `true` to perform deletion.
 *                      If false or omitted, no documents are deleted.
 * @returns An object containing:
 *          - ids: Array of lifelogIds that were deleted (or would have been)
 *          - count: Total number of affected lifelogs
 *          - deletedEmbeddings: Number of associated embeddings deleted
 */
export const deleteAllLifelogs = internalMutation({
  args: {
    destructive: v.boolean(), // Safety flag
  },
  handler: async (ctx, args) => {
    // Fetch all documents with their embeddings
    const allLifelogs = await ctx.db.query("lifelogs").collect();
    const count = allLifelogs.length;
    let deletedEmbeddings = 0;

    if (args.destructive === true) {
      console.warn(`DESTRUCTIVE OPERATION: Deleting ${count} lifelogs and their associated embeddings.`);
      for (const lifelog of allLifelogs) {
        await ctx.db.delete(lifelog._id);
        
        // Delete associated embedding if it exists
        const embeddingId = lifelog.embeddingId;
        if (embeddingId) {
          console.log(`Deleting embedding ${embeddingId} for lifelog ${lifelog._id}`);
          await ctx.db.delete(embeddingId);
          deletedEmbeddings++;
        }
      }
    } else {
      console.log(`NOTE: Destructive flag is false. Would have deleted ${count} lifelogs and their embeddings.`);
    }

    // Log the operation with detailed information
    const operation = lifelogOperation(
      "delete", 
      `Attempted deletion of all ${count} lifelogs and ${deletedEmbeddings} embeddings. Destructive: ${args.destructive}.`
    );
    await ctx.db.insert("operations", operation);

    return { 
      ids: allLifelogs.map(doc => doc.lifelogId),
      count,
      deletedEmbeddings
    };
  },
});

// NOTE: Currently disabled as it's not needed.
// /**
//  * Deletes duplicate lifelog documents based on `lifelogId`, keeping only the
//  * chronologically oldest document (by `_creationTime`) for each unique `lifelogId`.
//  * 
//  * @returns An object containing the count of deleted duplicates and the count of remaining unique documents.
//  */
// export const deleteDuplicates = internalMutation({
//   // No arguments needed, operates on the entire table
//   handler: async (ctx) => {
//     console.log("Starting duplicate lifelog deletion process...");
//     const allLifelogs = await ctx.db.query("lifelogs").collect();
//     console.log(`Found ${allLifelogs.length} total lifelogs.`);

//     // Map to store the oldest document found for each lifelogId
//     const oldestDocsMap = new Map<string, Doc<"lifelogs">>();

//     // Identify the oldest document for each lifelogId
//     for (const currentDoc of allLifelogs) {
//       const existingOldest = oldestDocsMap.get(currentDoc.lifelogId);
//       if (!existingOldest || currentDoc._creationTime < existingOldest._creationTime) {
//         oldestDocsMap.set(currentDoc.lifelogId, currentDoc);
//       }
//     }
//     console.log(`Identified ${oldestDocsMap.size} unique lifelogIds.`);

//     // Identify documents to delete (any document not in the oldestDocsMap values)
//     const duplicatesToDelete: Id<"lifelogs">[] = [];
//     const oldestDocIds = new Set([...oldestDocsMap.values()].map(doc => doc._id));

//     for (const currentDoc of allLifelogs) {
//       if (!oldestDocIds.has(currentDoc._id)) {
//         duplicatesToDelete.push(currentDoc._id);
//       }
//     }
//     console.log(`Identified ${duplicatesToDelete.length} duplicate documents to delete.`);

//     // Delete the identified duplicates
//     if (duplicatesToDelete.length > 0) {
//       for (const id of duplicatesToDelete) {
//         await ctx.db.delete(id);
//         // TODO: Should duplicates' embeddings be deleted too?
//       }
//       console.log(`Deleted ${duplicatesToDelete.length} duplicates.`);

//       // Log the deletion operation
//       const operation = lifelogOperation("delete", `Deleted ${duplicatesToDelete.length} duplicate lifelogs`);
//       await ctx.db.insert("operations", operation);
//     } else {
//       console.log("No duplicate lifelogs found to delete.");
//     }

//     return {
//       deletedCount: duplicatesToDelete.length,
//       remainingCount: oldestDocsMap.size,
//     };
//   },
// });