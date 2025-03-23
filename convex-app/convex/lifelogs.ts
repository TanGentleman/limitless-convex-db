// This file defines the CRUD operations for the lifelogs table
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

const EXPERIMENTAL_FETCH_LIMIT = 1;

// Define types
type ContentNode = {
  type: "heading1" | "heading2" | "heading3" | "blockquote";
  content: string;
  startTime?: number;
  endTime?: number;
  startOffsetMs?: number;
  endOffsetMs?: number;
  children?: ContentNode[];
  speakerName?: string | null;
  speakerIdentifier?: "user" | null;
};

export type LifelogNode = {
  id: string;
  title: string;
  markdown: string | null;
  startTime: number;
  endTime: number;
  contents: ContentNode[];
  embeddingId: Id<"markdownEmbeddings"> | null;
};

const lifelogObject = v.object({
  id: v.string(),
  title: v.string(),
  markdown: v.union(v.string(), v.null()),
  startTime: v.number(),
  endTime: v.number(),
  contents: v.array(v.object({
    type: v.union(v.literal("heading1"), v.literal("heading2"), v.literal("heading3"), v.literal("blockquote")),
    content: v.string(),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    startOffsetMs: v.optional(v.number()),
    endOffsetMs: v.optional(v.number()),
    children: v.optional(v.array(v.any())),
    speakerName: v.optional(v.union(v.string(), v.null())),
    speakerIdentifier: v.optional(v.union(v.literal("user"), v.null()))
  })),
})

// CREATE
// Add new lifelogs (Assume these have been de-duped from lifelog_ids in the meta table)
export const create = internalMutation({
  args: {
    lifelogs: v.array(lifelogObject),
  },
  handler: async (ctx, args) => {
    const lifelogs = args.lifelogs;
    for (const lifelog of lifelogs) {
      // Insert an embedding for the lifelog only if markdown exists
      const embeddingId = lifelog.markdown === null ? null : await ctx.db.insert("markdownEmbeddings", {
        lifelogId: lifelog.id,
        markdown: lifelog.markdown,
        embedding: undefined,
      });

      // Insert each lifelog to the database
      await ctx.db.insert("lifelogs", {
        lifelogId: lifelog.id,
        title: lifelog.title,
        markdown: lifelog.markdown,
        contents: lifelog.contents,
        startTime: lifelog.startTime,
        endTime: lifelog.endTime,
        embeddingId: embeddingId,
      });
    }
    
    return { ids: lifelogs.map((lifelog) => lifelog.id) };
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
    
    return { ids: lifelogs.map((lifelog) => lifelog.lifelogId) };
  },
});
