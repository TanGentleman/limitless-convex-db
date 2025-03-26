// Patch operations

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { Doc } from "../_generated/dataModel";

// Define the tables we can patch
type TableName = "operations" | "metadata" | "lifelogs";

// Process operations logs
function processOperationDoc(doc: Doc<"operations">): Partial<Doc<"operations">> | null {
  if (doc.data) {
    let message = '';
    
    // Only process logs with the specific fields
    if ('lifelogsAdded' in doc.data && 'lifelogsProcessed' in doc.data) {
      message = `Added ${doc.data.lifelogsAdded} of ${doc.data.lifelogsProcessed} processed lifelogs`;
    } 
    else if ('count' in doc.data && 'reason' in doc.data) {
      message = `Skipped ${doc.data.count} lifelogs (reason: ${doc.data.reason})`;
    }
    
    // Only return update if we have a message
    if (message) {
      return {
        data: { ...doc.data, message }
      };
    }
  }
  return null;
}

// Process metadata docs
function processMetadataDoc(doc: Doc<"metadata">): Partial<Doc<"metadata">> | null {
  // Add metadata-specific processing logic here
  return null;
}

// Process lifelog docs
function processLifelogDoc(doc: Doc<"lifelogs">): Partial<Doc<"lifelogs">> | null {
  // Add lifelog-specific processing logic here
  return null;
}

// Update documents with patches
export const patchOperations = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Process operations
    const operationLogs = await ctx.runQuery(internal.operations.readDocs, { limit: 100 });
    for (const log of operationLogs) {
      const update = processOperationDoc(log);
      if (update) {
        await ctx.db.patch(log._id, update);
      }
    }
    
    // Process metadata
    const metadataLogs = await ctx.runQuery(internal.metadata.readDocs, { all: true });
    for (const log of metadataLogs) {
      const update = processMetadataDoc(log);
      if (update) {
        await ctx.db.patch(log._id, update);
      }
    }
    
    // Process lifelogs
    const lifelogDocs = await ctx.runQuery(internal.lifelogs.readDocs, { limit: 100 });
    for (const log of lifelogDocs) {
      const update = processLifelogDoc(log);
      if (update) {
        await ctx.db.patch(log._id, update);
      }
    }
  },
});