// This file defines the CRUD operations for the lifelogs table
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { lifelogsDoc } from "./types";
import { internal } from "./_generated/api";


const defaultDirection = "asc";
const defaultLimit = 1000;
// CREATE
export const createDocs = internalMutation({
  args: {
    lifelogs: v.array(lifelogsDoc),
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
    let query;
    
    const startTime = args.startTime;
    const endTime = args.endTime;
    const direction = args.direction || defaultDirection;
    // Apply limit
    const limit = args.limit || defaultLimit; // Default limit
    // Apply time range filters if provided
    if (startTime !== undefined) {
      // If only startTime is provided
      const timeFilteredQuery = baseQuery.withIndex("by_start_time", (q) => 
        q.gte("startTime", startTime)
      );
      query = timeFilteredQuery;
    }
    
    // Apply sorting direction
    query = query.order(direction);
    
    
    const results = await query.take(limit);
    
    // Filter out markdown or headings if requested
    if (results.length > 0 && (args.includeMarkdown === false || args.includeHeadings === false)) {
      return results.map(lifelog => {
        const result = { ...lifelog };
        
        if (args.includeMarkdown === false) {
          result.markdown = null;
        }
        
        if (args.includeHeadings === false && result.contents) {
          result.contents = result.contents.filter(
            item => !["heading1", "heading2", "heading3"].includes(item.type)
          );
        }
        
        return result;
      });
    }
    
    return results;
  },
});

// UPDATE
// Update a lifelog by its ID
export const update = internalMutation({
  args: {
    id: v.id("lifelogs"),
    lifelog: lifelogsDoc,
  },
  handler: async (ctx, args) => {
    const { id, lifelog } = args;
    
    // Check if the lifelog exists
    const existingLifelog = await ctx.db.get(id);
    if (!existingLifelog) {
      throw new Error(`Lifelog with ID ${id} not found`);
    }
    
    // If markdown is updated and different from existing, create a new embedding
    let embeddingId = lifelog.embeddingId;
    if (lifelog.markdown !== undefined && 
        lifelog.markdown !== null && 
        lifelog.markdown !== existingLifelog.markdown) {
      // Create a new embedding for the updated markdown
      embeddingId = await ctx.db.insert("markdownEmbeddings", {
        lifelogId: existingLifelog.lifelogId,
        markdown: lifelog.markdown,
        embedding: undefined,
      });
      if (existingLifelog.embeddingId) {
        // console log the lifelogId to delete the old embedding
        await ctx.runMutation(internal.markdownEmbeddings.deleteDocs, { ids: [existingLifelog.embeddingId] });
      }
      // add operation to delete the old embedding
      await ctx.db.insert("operations", {
        operation: "delete",
        table: "markdownEmbeddings",
        success: true,
        data: { message: `Deleted old embedding for lifelog ${existingLifelog.lifelogId}` },
      });
    }
    
    // Update the lifelog with the new data
    await ctx.db.patch(id, {
      ...lifelog,
      embeddingId: embeddingId || lifelog.embeddingId,
    });
    
    // Log the update operation
    await ctx.db.insert("operations", {
      operation: "update",
      table: "lifelogs",
      success: true,
      data: {
        message: `Updated lifelog ${existingLifelog.lifelogId}`
      }
    });
    
    return { id, lifelogId: existingLifelog.lifelogId };
  },
});

// DELETE
// Delete a lifelog by its ID
export const deleteByLifelogId = internalMutation({
  args: {
    id: v.id("lifelogs"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Clear all lifelogs
export const deleteAll = internalMutation({
  args: {
    destructive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const lifelogs = await ctx.db.query("lifelogs").collect();
    
    // Delete each lifelog
    for (const lifelog of lifelogs) {
      if (!args.destructive) {
        console.log("NOTE: Destructive argument is false. Skipping deletion of lifelogs.");
        break;
      }
      await ctx.db.delete(lifelog._id);
    }
    
    // Log the delete operation once for the entire batch
    await ctx.db.insert("operations", {
      operation: "delete",
      table: "lifelogs",
      success: true,
      data: {
        message: `Deleted all ${lifelogs.length} lifelogs. (destructive: ${args.destructive})`
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
