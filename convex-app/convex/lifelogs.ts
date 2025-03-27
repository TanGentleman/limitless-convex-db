// This file defines the CRUD operations for the lifelogs table
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { lifelogDoc } from "./types";
import { internal } from "./_generated/api";
import { lifelogOperation, markdownEmbeddingOperation } from "./extras/utils";


const defaultDirection = "desc";
const defaultLimit = 1000;
// CREATE
export const createDocs = internalMutation({
  args: {
    lifelogs: v.array(lifelogDoc),
  },
  handler: async (ctx, args) => {
    const lifelogIds: string[] = [];
    
    for (const lifelog of args.lifelogs) {
      // Handle embedding logic:
      // 1. If an embeddingId is already provided in the lifelog, use it
      // 2. If no embeddingId but markdown exists, create a new embedding
      // 3. If no markdown, set embeddingId to null
      const embeddingId = lifelog.embeddingId 
        ? lifelog.embeddingId 
        : (lifelog.markdown === null 
            ? null 
            : await ctx.db.insert("markdownEmbeddings", {
                lifelogId: lifelog.lifelogId,
                markdown: lifelog.markdown,
                embedding: undefined,
              }));

      // Insert each lifelog to the database
      await ctx.db.insert("lifelogs", {
        lifelogId: lifelog.lifelogId,
        title: lifelog.title,
        markdown: lifelog.markdown,
        contents: lifelog.contents,
        startTime: lifelog.startTime,
        endTime: lifelog.endTime,
        embeddingId: embeddingId,
      });
      
      lifelogIds.push(lifelog.lifelogId);
    }
    
    const operation = lifelogOperation("create", `Created ${lifelogIds.length} new lifelogs`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return lifelogIds;
  },
});

// READ
export const readDocs = internalQuery({
  args: {
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    includeMarkdown: v.optional(v.boolean()),
    includeHeadings: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Start building the query
    const baseQuery = ctx.db.query("lifelogs");
    const startTime = args.startTime;
    const endTime = args.endTime;
    const direction = args.direction || defaultDirection;
    const limit = args.limit || defaultLimit; // Default limit
    
    // Apply time range filters if provided
    const timeFilteredQuery = startTime !== undefined 
      ? baseQuery.withIndex("by_start_time", (q) => q.gte("startTime", startTime))
      : baseQuery;
    
    // Apply sorting direction
    const sortedQuery = timeFilteredQuery.order(direction);
    
    // Apply endTime filter if provided
    const endTimeFilteredQuery = endTime !== undefined 
      ? sortedQuery.filter(q => q.lte(q.field("endTime"), endTime))
      : sortedQuery;
    
    // Get results with limit applied
    const results = await endTimeFilteredQuery.take(limit);
    
    // Filter out markdown or headings if requested
    // NOTE: Should be handled after the query is executed
    
    return results;
  },
});

export const getDocsByLifelogId = internalQuery({
  args: {
    lifelogIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const lifelogs: Doc<"lifelogs">[] = [];
    for (const lifelogId of args.lifelogIds) {
      const lifelog = await ctx.db.query("lifelogs").withIndex("by_lifelog_id", (q) => q.eq("lifelogId", lifelogId)).first();
      if (lifelog !== null) {
        lifelogs.push(lifelog);
      } else {
        console.log(`WARNING: Lifelog with ID ${lifelogId} not found`);
      }
    }
    return lifelogs;
  },
});

// UPDATE
export const updateDocs = internalMutation({
  args: {
    updates: v.array(v.object({
      id: v.id("lifelogs"),
      lifelog: lifelogDoc,
    })),
    abortOnError: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const updatedLifelogDocIds: Id<"lifelogs">[] = [];
    const operations: any[] = [];
    const embeddingsToDelete: Id<"markdownEmbeddings">[] = [];
    
    // Process each lifelog update in the batch
    for (const update of args.updates) {
      const { id, lifelog } = update;
      
      // ---------- VALIDATION ----------
      // Check if the lifelog exists in the database
      const existingLifelog = await ctx.db.get(id);
      if (!existingLifelog) {
        if (args.abortOnError) {
          throw new Error(`Lifelog with ID ${id} not found`);
        }
        else {
          console.log(`WARNING: Lifelog with ID ${id} not found`);
          continue;
        }
      }
      
      // ---------- EMBEDDING MANAGEMENT ----------
      // Handle markdown changes that require new vector embeddings
      let embeddingId = lifelog.embeddingId;
      if (lifelog.markdown !== undefined && 
          lifelog.markdown !== null && 
          lifelog.markdown !== existingLifelog.markdown) {
        // Create a new embedding for the updated markdown
        embeddingId = await ctx.db.insert("markdownEmbeddings", {
          lifelogId: existingLifelog.lifelogId,
          markdown: lifelog.markdown,
          embedding: undefined, // Will be processed by a separate job
        });
        
        // Track old embedding for deletion
        if (existingLifelog.embeddingId) {
          embeddingsToDelete.push(existingLifelog.embeddingId);
        }
      }
      
      // ---------- DATABASE UPDATE ----------
      // Update the lifelog with new data, ensuring embedding ID is preserved
      await ctx.db.patch(id, {
        ...lifelog,
        embeddingId: embeddingId || lifelog.embeddingId,
      });
      
      updatedLifelogDocIds.push(id);
    }
    
    // ---------- CLEANUP EMBEDDINGS ----------
    // Delete all tracked embeddings at once
    if (embeddingsToDelete.length > 0) {
      await ctx.runMutation(internal.markdownEmbeddings.deleteDocs, { 
        ids: embeddingsToDelete 
      });
      
      // Record the deletion operation
      const deleteEmbeddingOperation = markdownEmbeddingOperation(
        "delete", 
        `Deleted ${embeddingsToDelete.length} old embeddings`
      );
      operations.push(deleteEmbeddingOperation);
    }
    
    // ---------- OPERATION LOGGING ----------
    // Record the batch update operation
    operations.push(lifelogOperation("update", `Updated ${updatedLifelogDocIds.length} lifelogs`));
    await ctx.runMutation(internal.operations.createDocs, {
      operations: operations,
    });
    
    return updatedLifelogDocIds;
  },
});

// DELETE
export const deleteDocs = internalMutation({
  args: {
    ids: v.array(v.id("lifelogs")),
  },
  handler: async (ctx, args) => {
    
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
    
    const operation = lifelogOperation("delete", `Deleted ${args.ids.length} lifelogs`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
  },
});

// Clear all lifelogs
export const deleteAll = internalMutation({
  args: {
    destructive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const lifelogs = await ctx.db.query("lifelogs").collect();
    
    if (args.destructive) {
      // Delete each lifelog
      for (const lifelog of lifelogs) {
        await ctx.db.delete(lifelog._id);
      }
    } 
    else {
      console.log("NOTE: Destructive argument is false. Skipping deletion of lifelogs.");
    }
    
    const operation = lifelogOperation("delete", `Deleted all ${lifelogs.length} lifelogs. (destructive: ${args.destructive})`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return { ids: lifelogs.map((lifelog) => lifelog.lifelogId) };
  },
});

// Delete duplicate lifelogs, keeping only the oldest version of each
export const deleteDuplicates = internalMutation({
  handler: async (ctx) => {
    // Get all lifelogs
    const lifelogs = await ctx.db.query("lifelogs").collect();
    
    // Create a map to track the oldest document for each lifelogId
    const oldestLifelogs = new Map<string, Doc<"lifelogs">>();
    
    // Find the oldest document for each lifelogId
    for (const lifelog of lifelogs) {
      const existingLifelog = oldestLifelogs.get(lifelog.lifelogId);
      
      // If we haven't seen this ID before, or this is older than what we have, keep it
      if (!existingLifelog || lifelog._creationTime < existingLifelog._creationTime) {
        oldestLifelogs.set(lifelog.lifelogId, lifelog);
      }
    }
    
    // Identify duplicates (all documents except the oldest for each ID)
    const duplicatesToDelete: Id<"lifelogs">[] = [];
    for (const lifelog of lifelogs) {
      const oldestLifelog = oldestLifelogs.get(lifelog.lifelogId);
      if (oldestLifelog && lifelog._id !== oldestLifelog._id) {
        duplicatesToDelete.push(lifelog._id);
      }
    }
    
    // Delete the duplicates
    for (const id of duplicatesToDelete) {
      await ctx.db.delete(id);
    }
    
    const operation = lifelogOperation("delete", `Deleted ${duplicatesToDelete.length} duplicate lifelogs`);
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });
    
    return { 
      deletedCount: duplicatesToDelete.length,
      remainingCount: oldestLifelogs.size
    };
  },
});
