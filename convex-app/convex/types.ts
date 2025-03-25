import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";

// Define types
type ContentNode = {
  type: "heading1" | "heading2" | "heading3" | "blockquote";
  content: string;
  startTime?: string; // ISO format
  endTime?: string; // ISO format
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
  startTime?: string; // ISO format
  endTime?: string; // ISO format
  contents: ContentNode[];
};

  export const lifelogObject = v.object({
    lifelogId: v.string(),
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
    embeddingId: v.union(v.id("markdownEmbeddings"), v.null())
  })


  export const operationObject = v.array(v.object({
      operation: v.union(
        v.literal("sync"), 
        v.literal("create"), 
        v.literal("read"), 
        v.literal("update"), 
        v.literal("delete")
      ),
      table: v.union(
        v.literal("lifelogs"), 
        v.literal("metadata"), 
        v.literal("markdownEmbeddings")
      ),
      success: v.boolean(),
      data: v.object({
        message: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    }))

  
  /**
 * Converts lifelogs from API format to Convex database format.
 * 
 * @param lifelogs - Array of lifelogs from the API
 * @returns Array of lifelogs in Convex format
 */
export const convertToConvexFormat = (lifelogs: LifelogNode[]): Omit<Doc<"lifelogs">, "_id" | "_creationTime">[] => {
  return lifelogs.map(log => {
      if (!log.startTime || !log.endTime) {
          throw new Error(`Lifelog ${log.id} is missing required time fields`);
      }
      return {
          lifelogId: log.id,
          title: log.title,
          markdown: log.markdown,
          contents: log.contents.map(content => ({
              type: content.type,
              content: content.content,
              startTime: content.startTime ? new Date(content.startTime).getTime() : undefined,
              endTime: content.endTime ? new Date(content.endTime).getTime() : undefined,
          })),
          startTime: new Date(log.startTime).getTime(),
          endTime: new Date(log.endTime).getTime(),
          embeddingId: null,
      };
  });
}