import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  lifelogs: defineTable({
    lifelogId: v.string(),
    title: v.string(),
    markdown: v.union(v.string(), v.null()),
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
    startTime: v.number(),
    endTime: v.number(),
    embeddingId: v.union(v.id("markdownEmbeddings"), v.null()),
  })
  .index("by_start_time", ["startTime"])
  .index("by_end_time", ["endTime"])
  .index("by_time_range", ["startTime", "endTime"])
  .searchIndex("search_title_content", {
    searchField: "title",
  })
  .searchIndex("search_markdown_content", {
    searchField: "markdown",
  }),
  
  metadata: defineTable({
    startTime: v.number(),
    endTime: v.number(),
    syncedUntil: v.number(),
    lifelogIds: v.array(v.string()),
  }),
  
  operations: defineTable({
    operation: v.union(v.literal("sync"), v.literal("create"), v.literal("read"), v.literal("update"), v.literal("delete")),
    table: v.union(v.literal("lifelogs"), v.literal("metadata"), v.literal("markdownEmbeddings")),
    success: v.boolean(),
    data: v.object({
      message: v.optional(v.string()),
      error: v.optional(v.string()),
    })
  }),
  
  markdownEmbeddings: defineTable({
    lifelogId: v.string(),
    markdown: v.string(),
    embedding: v.optional(v.array(v.number())),
  })
  .vectorIndex("byEmbedding", {
    vectorField: "embedding",
    dimensions: 1536,
  }),
});