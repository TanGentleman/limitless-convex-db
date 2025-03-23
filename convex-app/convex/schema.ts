import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  lifelogs: defineTable({
    lifelog_id: v.string(),
    title: v.string(),
    markdown: v.string(),
    contents: v.array(v.object({
      type: v.union(v.literal("heading1"), v.literal("heading2"), v.literal("blockquote")),
      content: v.string(),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      startOffsetMs: v.optional(v.number()),
      endOffsetMs: v.optional(v.number()),
      children: v.optional(v.array(v.any())),
      speakerName: v.optional(v.string()),
      speakerIdentifier: v.optional(v.union(v.literal("user"), v.null()))
    })),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    // If the chunk has been embedded, which embedding corresponds to it
    embeddingId: v.union(v.id("embeddings"), v.null()),
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
    timestamp: v.number(),
    operation: v.union(v.literal("sync"), v.literal("create"), v.literal("read"), v.literal("update"), v.literal("delete")),
    data: v.any()
  })
  .index("by_timestamp", ["timestamp"]),
  
  markdownEmbeddings: defineTable({
    lifelog_id: v.string(),
    markdown: v.string(),
    embedding: v.array(v.number()),
  })
  .vectorIndex("byEmbedding", {
    vectorField: "embedding",
    dimensions: 1536,
  }),
});