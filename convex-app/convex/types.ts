import { v } from "convex/values";

export const lifelogObject = v.object({
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