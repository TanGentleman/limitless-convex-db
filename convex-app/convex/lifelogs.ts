/**
 * This file defines the CRUD (Create, Read, Update, Delete) operations 
 * and utility functions for the 'lifelogs' table in the Convex database.
 * It includes handling for associated markdown embeddings.
 */
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { lifelogDoc } from "./types";
import { internal } from "./_generated/api";
import { lifelogOperation, markdownEmbeddingOperation } from "./extras/utils";

// Default values for querying
const defaultDirection = "desc";
const defaultLimit = 1;

// === CREATE ===

/**
 * Creates multiple lifelog documents in a batch.
 * Handles the creation of associated markdown embeddings if markdown content exists
 * and no embeddingId is provided.
 * 
 * @param lifelogs - An array of lifelog document data to insert.
 * @returns An array of the `lifelogId`s (not `_id`) for the created documents.
 */
export const createDocs = internalMutation({
  args: {
    lifelogs: v.array(lifelogDoc),
  },
  handler: async (ctx, args) => {
    const createdLifelogIds: string[] = [];

    for (const lifelog of args.lifelogs) {
      let embeddingId: Id<"markdownEmbeddings"> | null = lifelog.embeddingId ?? null;

      // Create a new embedding if markdown exists and no embeddingId was provided
      if (!embeddingId && lifelog.markdown) {
        embeddingId = await ctx.db.insert("markdownEmbeddings", {
          lifelogId: lifelog.lifelogId, // Link embedding to the lifelog
          markdown: lifelog.markdown,
          embedding: undefined, // Embedding vector will be generated later
        });
      }

      // Insert the lifelog document
      await ctx.db.insert("lifelogs", {
        ...lifelog, // Spread operator for conciseness
        embeddingId: embeddingId, // Use the determined embeddingId
      });

      createdLifelogIds.push(lifelog.lifelogId);
    }

    // Log the creation operation
    const operation = lifelogOperation("create", `Created ${createdLifelogIds.length} new lifelogs`);
    await ctx.db.insert("operations", operation);

    return createdLifelogIds;
  },
});

// === READ ===

/**
 * Reads lifelog documents based on optional time range, sorting, and limit.
 * 
 * @param startTime - Optional minimum startTime (inclusive).
 * @param endTime - Optional maximum endTime (inclusive).
 * @param direction - Optional sort direction ('asc' or 'desc') based on startTime. Defaults to 'desc'.
 * @param limit - Optional maximum number of documents to return. Defaults to 10.
 * @returns An array of lifelog documents matching the criteria.
 */
export const readDocs = internalQuery({
  args: {
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    // includeMarkdown: v.optional(v.boolean()), // NOTE: Removed as not implemented
    // includeHeadings: v.optional(v.boolean()), // NOTE: Removed as not implemented
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
    const rangeFilteredQuery = endTime !== undefined
      ? sortedQuery.filter(q => q.lte(q.field("endTime"), endTime))
      : sortedQuery;
    
    // Apply limit and execute the query
    const results = await rangeFilteredQuery.take(limit);
    
    // NOTE: Filtering 'markdown' or 'headings' post-query was mentioned but not implemented.
    // If needed, it should be done here by mapping over `results`.

    return results;
  },
});

/**
 * Retrieves specific lifelog documents by their `lifelogId`.
 * 
 * @param lifelogIds - An array of `lifelogId` strings to fetch.
 * @returns An array of found lifelog documents. Logs warnings for missing IDs.
 */
export const getDocsByLifelogId = internalQuery({
  args: {
    lifelogIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const lifelogs: Doc<"lifelogs">[] = [];
    for (const lifelogId of args.lifelogIds) {
      // Use the 'by_lifelog_id' index for efficient lookup
      const lifelog = await ctx.db
        .query("lifelogs")
        .withIndex("by_lifelog_id", (q) => q.eq("lifelogId", lifelogId))
        .first(); // Use first() as lifelogId should be unique (or we only want one)

      if (lifelog) {
        lifelogs.push(lifelog);
      } else {
        console.warn(`WARNING: Lifelog with lifelogId ${lifelogId} not found`);
      }
    }
    return lifelogs;
  },
});

// === UPDATE ===

/**
 * Updates multiple lifelog documents in a batch.
 * Handles changes to markdown content by creating new embeddings and deleting old ones.
 * 
 * @param updates - An array of objects, each containing the `_id` of the document to update 
 *                  and the new `lifelog` data.
 * @param abortOnError - If true, the entire operation fails if any single update fails 
 *                       (e.g., document not found). If false (default), skips failed updates 
 *                       and logs warnings.
 * @returns An array of the `_id`s of the successfully updated documents.
 */
export const updateDocs = internalMutation({
  args: {
    updates: v.array(v.object({
      id: v.id("lifelogs"), // Use the Convex document _id for updates
      lifelog: lifelogDoc,   // The new data for the lifelog
    })),
    abortOnError: v.optional(v.boolean()), // Default is false/undefined
  },
  handler: async (ctx, args) => {
    const updatedDocIds: Id<"lifelogs">[] = [];
    const embeddingsToDelete: Id<"markdownEmbeddings">[] = [];

    for (const update of args.updates) {
      const { id, lifelog: updatedLifelogData } = update;

      // --- 1. Validation ---
      const existingLifelog = await ctx.db.get(id);
      if (!existingLifelog) {
        const errorMsg = `Lifelog with _id ${id} not found for update.`;
        if (args.abortOnError) {
          throw new Error(errorMsg);
        } else {
          console.warn(`WARNING: ${errorMsg} Skipping.`);
          continue; // Skip this update
        }
      }

      // --- 2. Embedding Management ---
      let newEmbeddingId: Id<"markdownEmbeddings"> | null | undefined = updatedLifelogData.embeddingId; // Start with provided ID

      // Check if markdown content has changed and is not null/undefined
      const markdownChanged = updatedLifelogData.markdown !== undefined &&
                              updatedLifelogData.markdown !== null &&
                              updatedLifelogData.markdown !== existingLifelog.markdown;

      if (markdownChanged) {
        // Create a new embedding record
        newEmbeddingId = await ctx.db.insert("markdownEmbeddings", {
          lifelogId: existingLifelog.lifelogId, // Use the stable lifelogId
          markdown: updatedLifelogData.markdown!, // Not null/undefined due to check above
          embedding: undefined, // To be generated later
        });

        // Mark the old embedding for deletion, if it exists
        if (existingLifelog.embeddingId) {
          embeddingsToDelete.push(existingLifelog.embeddingId);
        }
      } else {
         // If markdown didn't change, ensure we keep the existing embeddingId 
         // unless explicitly set to null/undefined in the update data.
         // If updatedLifelogData.embeddingId is undefined, keep the existing one.
         newEmbeddingId = updatedLifelogData.embeddingId === undefined 
            ? existingLifelog.embeddingId 
            : updatedLifelogData.embeddingId;
      }


      // --- 3. Database Update ---
      await ctx.db.patch(id, {
        ...updatedLifelogData,
        embeddingId: newEmbeddingId, // Use the determined embeddingId
      });

      updatedDocIds.push(id);
    }

    // --- 4. Cleanup Old Embeddings ---
    if (embeddingsToDelete.length > 0) {
      // Call the delete function for markdownEmbeddings
      await ctx.runMutation(internal.markdownEmbeddings.deleteDocs, {
        ids: embeddingsToDelete,
      });

      // Log the embedding deletion operation
      const deleteEmbeddingOp = markdownEmbeddingOperation(
        "delete",
        `Deleted ${embeddingsToDelete.length} old markdown embeddings due to lifelog updates.`
      );
      await ctx.db.insert("operations", deleteEmbeddingOp);
    }

    // --- 5. Operation Logging ---
    if (updatedDocIds.length > 0) {
      const operation = lifelogOperation("update", `Updated ${updatedDocIds.length} lifelogs`);
      await ctx.db.insert("operations", operation);
    }

    return updatedDocIds;
  },
});


// === DELETE ===

/**
 * Deletes multiple lifelog documents by their `_id`.
 * Note: This currently does *not* automatically delete associated markdown embeddings.
 * Embeddings are typically deleted during updates or potentially via a separate cleanup process.
 * 
 * @param ids - An array of `_id`s of the lifelog documents to delete.
 * @returns The array of `_id`s that were requested for deletion.
 */
export const deleteDocs = internalMutation({
  args: {
    ids: v.array(v.id("lifelogs")),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id); 
      // Potential enhancement: Check if lifelog had an embeddingId and delete that too.
    }

    // Log the deletion operation
    if (args.ids.length > 0) {
      const operation = lifelogOperation("delete", `Deleted ${args.ids.length} lifelogs`);
      await ctx.db.insert("operations", operation);
    }
    
    // Return the list of IDs requested for deletion
    return args.ids; 
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
export const deleteAll = internalMutation({
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

/**
 * Deletes duplicate lifelog documents based on `lifelogId`, keeping only the
 * chronologically oldest document (by `_creationTime`) for each unique `lifelogId`.
 * 
 * @returns An object containing the count of deleted duplicates and the count of remaining unique documents.
 */
export const deleteDuplicates = internalMutation({
  // No arguments needed, operates on the entire table
  handler: async (ctx) => {
    console.log("Starting duplicate lifelog deletion process...");
    const allLifelogs = await ctx.db.query("lifelogs").collect();
    console.log(`Found ${allLifelogs.length} total lifelogs.`);

    // Map to store the oldest document found for each lifelogId
    const oldestDocsMap = new Map<string, Doc<"lifelogs">>();

    // Identify the oldest document for each lifelogId
    for (const currentDoc of allLifelogs) {
      const existingOldest = oldestDocsMap.get(currentDoc.lifelogId);
      if (!existingOldest || currentDoc._creationTime < existingOldest._creationTime) {
        oldestDocsMap.set(currentDoc.lifelogId, currentDoc);
      }
    }
    console.log(`Identified ${oldestDocsMap.size} unique lifelogIds.`);

    // Identify documents to delete (any document not in the oldestDocsMap values)
    const duplicatesToDelete: Id<"lifelogs">[] = [];
    const oldestDocIds = new Set([...oldestDocsMap.values()].map(doc => doc._id));

    for (const currentDoc of allLifelogs) {
      if (!oldestDocIds.has(currentDoc._id)) {
        duplicatesToDelete.push(currentDoc._id);
      }
    }
    console.log(`Identified ${duplicatesToDelete.length} duplicate documents to delete.`);

    // Delete the identified duplicates
    if (duplicatesToDelete.length > 0) {
      for (const id of duplicatesToDelete) {
        await ctx.db.delete(id);
        // TODO: Should duplicates' embeddings be deleted too?
      }
      console.log(`Deleted ${duplicatesToDelete.length} duplicates.`);

      // Log the deletion operation
      const operation = lifelogOperation("delete", `Deleted ${duplicatesToDelete.length} duplicate lifelogs`);
      await ctx.db.insert("operations", operation);
    } else {
      console.log("No duplicate lifelogs found to delete.");
    }

    return {
      deletedCount: duplicatesToDelete.length,
      remainingCount: oldestDocsMap.size,
    };
  },
});
