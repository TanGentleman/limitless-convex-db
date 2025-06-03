// This file defines operations for handling markdown embeddings
import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { markdownEmbeddingDoc } from './types';
import { markdownEmbeddingOperation } from './extras/utils';
import { Doc, Id } from './_generated/dataModel';
// CREATE
// Store a new markdown embedding
export const createDocs = internalMutation({
  args: { docs: v.array(markdownEmbeddingDoc) },
  handler: async (ctx, args) => {
    for (const doc of args.docs) {
      await ctx.db.insert('markdownEmbeddings', doc);
    }
  },
});

// READ
// Get a specific embedding by ID
export const getById = internalQuery({
  args: { id: v.id('markdownEmbeddings') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// UPDATE
// Update existing embeddings
// Accepts an array of updates for markdown embeddings
// - id: The ID of the embedding to update
// - embedding: Optional new embedding array or null (null value for embedding unsets the value)
// - markdown: Optional new markdown content
export const updateDocs = internalMutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id('markdownEmbeddings'),
        embedding: v.optional(v.union(v.array(v.number()), v.null())),
        markdown: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const updatedIds: Id<'markdownEmbeddings'>[] = [];

    for (const update of args.updates) {
      const existingEmbedding = await ctx.db.get(update.id);
      if (!existingEmbedding) {
        console.error(`Embedding with ID ${update.id} not found`);
        continue;
      }
      // only add provided fields to the update
      const updateFields: Partial<Doc<'markdownEmbeddings'>> = {};
      if (update.embedding === null) {
        updateFields.embedding = undefined;
      } else if (update.embedding !== undefined) {
        updateFields.embedding = update.embedding;
      }
      if (update.markdown !== undefined) {
        updateFields.markdown = update.markdown;
      }
      if (Object.keys(updateFields).length === 0) {
        console.error(`No valid fields to update for embedding ${update.id}`);
        continue;
      }

      await ctx.db.patch(update.id, updateFields);
      updatedIds.push(update.id);
    }

    const operation = markdownEmbeddingOperation(
      'update',
      `Updated ${updatedIds.length} embeddings`,
    );
    await ctx.db.insert('operations', operation);

    return updatedIds;
  },
});

// DELETE
export const deleteDocs = internalMutation({
  args: { ids: v.array(v.id('markdownEmbeddings')) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
  },
});

// SEARCH
// Search using cosine similarity over embeddings
