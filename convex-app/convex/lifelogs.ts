// This file defines the CRUD operations for the lifelogs table
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { lifelogObject } from "./types";

// CREATE
// Add new lifelogs (Assume these have been de-duped from lifelog_ids in the meta table)
export const create = internalMutation({
  args: {
    lifelogs: v.array(lifelogObject),
  },
  handler: async (ctx, args) => {
    const lifelogIds: string[] = [];
    
    for (const lifelog of args.lifelogs) {
      // Insert an embedding for the lifelog only if markdown exists
      const embeddingId = lifelog.markdown === null ? null : await ctx.db.insert("markdownEmbeddings", {
        lifelogId: lifelog.lifelogId,
        markdown: lifelog.markdown,
        embedding: undefined,
      });

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
    
    return lifelogIds;
  },
});

// DELETE
// Clear all lifelogs
export const deleteAll = internalMutation({
  handler: async (ctx) => {
    const lifelogs = await ctx.db.query("lifelogs").collect();
    
    // Delete each lifelog
    for (const lifelog of lifelogs) {
      await ctx.db.delete(lifelog._id);
    }
    
    // Log the delete operation once for the entire batch
    await ctx.db.insert("operations", {
      operation: "delete",
      table: "lifelogs",
      success: true,
      data: {
        message: `Deleted all ${lifelogs.length} lifelogs`
      }
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
    
    // Log the operation once for the entire batch deletion
    if (duplicatesToDelete.length > 0) {
      await ctx.db.insert("operations", {
        operation: "delete",
        table: "lifelogs",
        success: true,
        data: {
          message: `Deleted ${duplicatesToDelete.length} duplicates`
        }
      });
    }
    
    return { 
      deletedCount: duplicatesToDelete.length,
      remainingCount: oldestLifelogs.size
    };
  },
});
