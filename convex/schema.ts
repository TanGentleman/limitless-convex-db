import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const contentsNode = v.object({
  type: v.union(
    v.literal('heading1'),
    v.literal('heading2'),
    v.literal('heading3'),
    v.literal('blockquote'),
    v.literal('paragraph'),
  ),
  content: v.string(),
  startTime: v.optional(v.number()),
  endTime: v.optional(v.number()),
  startOffsetMs: v.optional(v.number()),
  endOffsetMs: v.optional(v.number()),
  children: v.optional(v.array(v.any())),
  speakerName: v.optional(v.union(v.string(), v.null())),
  speakerIdentifier: v.optional(v.union(v.literal('user'), v.null())),
});

export const lifelogDoc = v.object({
  lifelogId: v.string(),
  title: v.string(),
  markdown: v.union(v.string(), v.null()),
  startTime: v.number(),
  endTime: v.number(),
  updatedAt: v.optional(v.number()),
  isStarred: v.optional(v.boolean()),
  contents: v.array(contentsNode),
  embeddingId: v.union(v.id('markdownEmbeddings'), v.null()),
});

export const operationsDoc = v.object({
  operation: v.union(
    v.literal('sync'),
    v.literal('create'),
    v.literal('read'),
    v.literal('update'),
    v.literal('delete'),
  ),
  table: v.union(
    v.literal('lifelogs'),
    v.literal('metadata'),
    v.literal('markdownEmbeddings'),
  ),
  success: v.boolean(),
  data: v.object({
    message: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
});

export const metadataDoc = v.object({
  startTime: v.number(),
  endTime: v.number(),
  syncedUntil: v.number(),
  lifelogIds: v.array(v.string()),
});

export const markdownEmbeddingDoc = v.object({
  markdown: v.string(),
  embedding: v.optional(v.array(v.number())),
  lifelogId: v.string(),
});

export default defineSchema({
  lifelogs: defineTable(lifelogDoc)
    .index('by_start_time', ['startTime'])
    .index('by_lifelog_id', ['lifelogId'])
    // .searchIndex('search_title', {
    //   searchField: 'title',
    // })
    .searchIndex('search_markdown', {
      searchField: 'markdown',
    }),

  metadata: defineTable(metadataDoc),

  operations: defineTable(operationsDoc),
  markdownEmbeddings: defineTable(markdownEmbeddingDoc)
    .vectorIndex('byEmbedding', {
      vectorField: 'embedding',
      dimensions: 1536,
  }),
});
