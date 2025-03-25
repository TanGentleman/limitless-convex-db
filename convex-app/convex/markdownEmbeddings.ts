// This file defines operations for handling markdown embeddings
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { markdownEmbeddingDoc } from "./types";

// CREATE
// Store a new markdown embedding
export const create = internalMutation({
  args: markdownEmbeddingDoc,
  handler: async (ctx, args) => {
    return await ctx.db.insert("markdownEmbeddings", args);
  },
});

// READ
// Get a specific embedding by ID
export const getById = internalQuery({
  args: { id: v.id("markdownEmbeddings") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// UPDATE
// Update an existing embedding
export const updateEmbedding = internalMutation({
  args: {
    id: v.id("markdownEmbeddings"),
    embedding: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    return await ctx.db.patch(id, updates);
  },
});

// DELETE
// Remove an embedding
export const remove = internalMutation({
  args: { id: v.id("markdownEmbeddings") },
  handler: async (ctx, args) => {
    return await ctx.db.delete(args.id);
  },
});

// SEARCH
// Search using cosine similarity over embeddings
