import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  lifelogs: defineTable({
    id: v.string(),
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
    timestamp: v.optional(v.number()), // Unix timestamp (milliseconds since epoch)
  })
  .index("by_timestamp", ["timestamp"])
  .searchIndex("search_title_content", {
    searchField: "title",
  }),
  
  metadata: defineTable({
    localSyncTime: v.string(), // ISO-8601 string
    localLogCount: v.number(),
    cloudSyncTime: v.string(), // ISO-8601 string
    cloudLogCount: v.number(),
    ids: v.array(v.string())
  })
});