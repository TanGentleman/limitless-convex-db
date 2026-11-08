/**
 * This file defines the CRUD (Create, Read, Update, Delete) operations
 * and utility functions for the 'lifelogs' table in the Convex database.
 * It includes handling for associated markdown embeddings.
 */
import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { Doc, Id } from './_generated/dataModel';
import { lifelogDoc } from './schema';
import { internal } from './_generated/api';
import { lifelogOperation, markdownEmbeddingOperation } from './extras/utils';
import { paginationOptsValidator } from 'convex/server';

// Default values for querying
const defaultDirection = 'desc';
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
      let embeddingId: Id<'markdownEmbeddings'> | null = lifelog.embeddingId;

      // Create a new embedding if markdown exists and no embeddingId was provided
      if (embeddingId === null && lifelog.markdown) {
        embeddingId = await ctx.db.insert('markdownEmbeddings', {
          lifelogId: lifelog.lifelogId, // Link embedding to the lifelog
          markdown: lifelog.markdown,
          embedding: undefined, // Embedding vector will be generated later
        });
        // Schedule the embedding generation
      }

      // Insert the lifelog document
      await ctx.db.insert('lifelogs', {
        ...lifelog, // Spread operator for conciseness
        embeddingId: embeddingId, // Use the determined embeddingId
      });

      createdLifelogIds.push(lifelog.lifelogId);
    }

    // Log the creation operation
    const operation = lifelogOperation(
      'create',
      `Created ${createdLifelogIds.length} new lifelogs`,
    );
    await ctx.db.insert('operations', operation);

    return createdLifelogIds;
  },
});

// === READ ===

/**
 * Reads lifelog documents based on optional time range, sorting, and pagination.
 * Input type should match LifelogQueryParams in types.ts
 *
 * @param paginationOpts - Pagination options including cursor and number of items.
 * @param startTime - Optional minimum startTime (inclusive).
 * @param endTime - Optional maximum startTime (exclusive).
 * @param isStarred - Optional; true returns only starred lifelogs.
 * @param direction - Optional sort direction ('asc' or 'desc') based on startTime. Defaults to 'desc'.
 * @returns Paginated results containing lifelog documents matching the criteria and pagination metadata.
 */
export const paginatedDocs = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    direction: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
    isStarred: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Start building the query
    const baseQuery = ctx.db.query('lifelogs');
    const startTime = args.startTime;
    const endTime = args.endTime;
    const direction = args.direction || defaultDirection;

    // Lifelogs are filtered by when they start: start <= startTime < end.
    const timeFilteredQuery = baseQuery.withIndex('by_start_time', (q) => {
      if (startTime !== undefined && endTime !== undefined) {
        return q.gte('startTime', startTime).lt('startTime', endTime);
      }
      if (startTime !== undefined) return q.gte('startTime', startTime);
      if (endTime !== undefined) return q.lt('startTime', endTime);
      return q;
    });

    const orderedQuery = timeFilteredQuery.order(direction);
    const sortedQuery =
      args.isStarred === true
        ? orderedQuery.filter((q) => q.eq(q.field('isStarred'), true))
        : orderedQuery;
    return await sortedQuery.paginate(args.paginationOpts);
  },
  // NOTE: Add "read operation when running in a mutation
});

/**
 * Retrieves specific lifelog documents by their Convex document IDs.
 *
 * @param ids - An array of document IDs (Id<"lifelogs">) to fetch.
 * @returns An array of found lifelog documents. Logs warnings for missing IDs.
 */
export const getDocsById = internalQuery({
  args: {
    ids: v.array(v.id('lifelogs')),
  },
  handler: async (ctx, args) => {
    const lifelogs: Doc<'lifelogs'>[] = [];
    for (const id of args.ids) {
      const lifelog = await ctx.db.get(id);
      if (lifelog) {
        lifelogs.push(lifelog);
      } else {
        console.warn(`WARNING: Lifelog with id ${id} not found`);
      }
    }
    return lifelogs;
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
    const lifelogs: Doc<'lifelogs'>[] = [];
    for (const lifelogId of args.lifelogIds) {
      // Use the 'by_lifelog_id' index for efficient lookup
      const lifelog = await ctx.db
        .query('lifelogs')
        .withIndex('by_lifelog_id', (q) => q.eq('lifelogId', lifelogId))
        .first();

      if (lifelog) {
        lifelogs.push(lifelog);
      } else {
        console.warn(`WARNING: Lifelog with lifelogId ${lifelogId} not found`);
      }
    }
    return lifelogs;
  },
});

export const getById = internalQuery({
  args: {
    ids: v.array(v.id('lifelogs')),
  },
  handler: async (ctx, args) => {
    const lifelogs: Doc<'lifelogs'>[] = [];
    for (const id of args.ids) {
      const lifelog = await ctx.db.get(id);
      if (lifelog !== null) {
        lifelogs.push(lifelog);
      } else {
        console.warn(`WARNING: Lifelog with id ${id} not found`);
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
    updates: v.array(
      v.object({
        id: v.id('lifelogs'), // Use the Convex document _id for updates
        lifelog: lifelogDoc, // The new data for the lifelog
      }),
    ),
    abortOnError: v.optional(v.boolean()), // Default is false/undefined
  },
  handler: async (ctx, args) => {
    const updatedDocIds: Id<'lifelogs'>[] = [];
    const embeddingsToDelete: Id<'markdownEmbeddings'>[] = [];

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
      let newEmbeddingId: Id<'markdownEmbeddings'> | null | undefined =
        updatedLifelogData.embeddingId; // Start with provided ID

      // Check if markdown content has changed and is not null/undefined
      const markdownChanged =
        updatedLifelogData.markdown !== undefined &&
        updatedLifelogData.markdown !== null &&
        updatedLifelogData.markdown !== existingLifelog.markdown;

      if (markdownChanged) {
        // Create a new embedding record
        newEmbeddingId = await ctx.db.insert('markdownEmbeddings', {
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
        newEmbeddingId =
          updatedLifelogData.embeddingId === undefined
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
        'delete',
        `Deleted ${embeddingsToDelete.length} old markdown embeddings due to lifelog updates.`,
      );
      await ctx.db.insert('operations', deleteEmbeddingOp);
    }

    // --- 5. Operation Logging ---
    if (updatedDocIds.length > 0) {
      const operation = lifelogOperation(
        'update',
        `Updated ${updatedDocIds.length} lifelogs`,
      );
      await ctx.db.insert('operations', operation);
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
    ids: v.array(v.id('lifelogs')),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
      // Potential enhancement: Check if lifelog had an embeddingId and delete that too.
    }

    // Log the deletion operation
    if (args.ids.length > 0) {
      const operation = lifelogOperation(
        'delete',
        `Deleted ${args.ids.length} lifelogs`,
      );
      await ctx.db.insert('operations', operation);
    }

    // Return the list of IDs requested for deletion
    return args.ids;
  },
});

/**
 * Performs a full text search on the `markdown` field of lifelogs, with optional additional filtering.
 *
 * Results are returned in relevance order (best matches first).
 * Supports pagination via Convex's pagination options.
 *
 * @param query - The search string (can be multiple words).
 * @param paginationOpts - Pagination options (cursor, numItems, etc).
 * @param startTime - (Optional) Only lifelogs starting at or after this time (ms).
 * @param endTime - (Optional) Only lifelogs starting before this time (ms).
 * @param isStarred - (Optional) Only starred lifelogs.
 * @returns Paginated lifelog documents matching the search query and filters.
 *
 * Example usage:
 *   const results = await ctx.runQuery(internal.lifelogs.searchMarkdown, {
 *     query: "meeting notes",
 *     paginationOpts: { numItems: 10 },
 *     startTime: Date.now() - 10 * 60 * 1000, // last 10 minutes
 *   });
 */
export const searchMarkdown = internalQuery({
  args: {
    query: v.string(),
    paginationOpts: paginationOptsValidator,
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    isStarred: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const queryString = args.query.trim();
    const { startTime, endTime, isStarred } = args;
    if (queryString.length === 0) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    return await ctx.db
      .query('lifelogs')
      .withSearchIndex('search_markdown', (q) =>
        q.search('markdown', queryString),
      )
      .filter((q) =>
        q.and(
          startTime === undefined ? true : q.gte(q.field('startTime'), startTime),
          endTime === undefined ? true : q.lt(q.field('startTime'), endTime),
          isStarred === true ? q.eq(q.field('isStarred'), true) : true,
        ),
      )
      .paginate(args.paginationOpts);
  },
});
