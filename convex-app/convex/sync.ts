import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, } from "./_generated/server";
import { LifelogNode, lifelogObject } from "./lifelogs";

/**
 * Request parameters for retrieving lifelogs.
 * Matches the Limitless API query parameters.
 */
export type LifelogRequest = {
  timezone?: string;      // IANA timezone specifier. If missing, UTC is used
  date?: string;          // Format: YYYY-MM-DD
  start?: string;         // Modified ISO-8601 format (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS)
  end?: string;           // Modified ISO-8601 format (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS)
  cursor?: string;        // Cursor for pagination
  direction?: "asc" | "desc"; // Sort direction: "asc" or "desc", default "desc"
  include_markdown?: boolean; // Whether to include markdown content, default true
  include_headings?: boolean; // Whether to include headings, default false
  limit?: number;         // Maximum number of entries to return
}

// TODO: Add tracking of operations and insert into operations table
export const syncLimitless = internalAction({
    args: {
        startTime: v.number(),
    },
    handler: async (ctx, args) => {
        // 1. Call internal.metadata.getLatest to get meta
        const meta = await ctx.runQuery(internal.metadata.getLatest);
        if (meta.length === 0) {
            console.log("No metadata found, creating default");
            const metaId = await ctx.runMutation(internal.metadata.createDefaultMeta);
            if (metaId === null) {
                console.log("Failed to create default metadata! Aborting sync.");
                return null;
            }
        }
        const start = new Date(args.startTime).toISOString();
        
        // 2. Fetch lifelogs from Limitless API
        const lifelogs = await fetchLifelogs(
            {
                start: start,
            }
        );
        // 3. Remove duplicates from metadata
        let newLifelogs: LifelogNode[] = [];
        for (const log of lifelogs) {
            if (!meta[0].lifelogIds.includes(log.id)) {
                newLifelogs.push(log);
            }
        }
        if (newLifelogs.length === 0) {
            console.log("No new lifelogs to add.");
        } else {
            console.log(`Found ${newLifelogs.length} new lifelogs to add.`);
        }
        
        // 4. Convert lifelogs to Convex format
        const convexLifelogs = newLifelogs.map(log => {
            if (!log.startTime) {
                throw new Error(`Lifelog ${log.id} is missing startTime`);
            }
            if (!log.endTime) {
                throw new Error(`Lifelog ${log.id} is missing endTime`);
            }
            
            return {
                id: log.id,
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
            };
        });
        const lifelogIds = await ctx.runMutation(internal.lifelogs.create, {
            lifelogs: convexLifelogs
        });
        
//         // 5. Update meta
//         if (lifelogs.length > 0) {
//             await ctx.runMutation(internal.metadata.updateLastSync, {
//                 lastSync: Date.now()
//             });
//         }
        
//         // 6. Report operations to the operations table
//         await ctx.runMutation(internal.operations.recordSync, {
//             startTime: args.startTime,
//             endTime: Date.now(),
//             lifelogsProcessed: lifelogs.length,
//             lifelogsAdded: addedCount,
//         });
        
//         return {
//             processed: lifelogs.length,
//             added: addedCount
//         };
    },
});

// Helper function to fetch lifelogs from the Limitless API
async function fetchLifelogs(args: LifelogRequest) {
    const API_KEY = process.env.LIMITLESS_API_KEY;
    if (!API_KEY) {
        console.log('No api key.')
        throw new Error("LIMITLESS_API_KEY environment variable not set");
    }
    console.log('process.env.TIMEZONE')
    throw new Error('Intentional error.')
    
    const allLifelogs = [];
    let cursor = args.cursor;
    const limit = args.limit || 50;
    let batchSize = args.limit || 10;
    
    // If limit is not null, set a batch size and fetch until we reach the limit
    if (limit !== null) {
        batchSize = Math.min(batchSize, limit);
    }
    
    while (true) {
        const params: LifelogRequest = {
            limit: batchSize,
            include_markdown: args.include_markdown === false ? false : true,
            include_headings: args.include_headings === false ? false : true,
            start: args.start,
            direction: args.direction || "asc",
            timezone: args.timezone || process.env.TIMEZONE
        };
        
        // Add cursor for pagination if we have one
        if (cursor) {
            params.cursor = cursor;
        }
        
        console.log(`Fetching lifelogs with params: ${JSON.stringify(params)}`);
        
        let allLifelogs: LifelogNode[] = [];
        try {
            const response = await fetch("https://api.limitless.ai/v1/lifelogs", {
                headers: {
                    "X-API-Key": API_KEY
                },
                method: "GET",
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            
            const data = await response.json();
            const lifelogs: LifelogNode[] = data.data?.lifelogs || [];
            
            // Add lifelogs from this batch
            allLifelogs.push(...lifelogs);
            
            // Check if we've reached the requested limit
            if (allLifelogs.length >= limit) {
                return allLifelogs.slice(0, limit);
            }
            
            // Get the next cursor from the response
            const nextCursor = data.meta?.lifelogs?.nextCursor;
            
            // If there's no next cursor or we got fewer results than requested, we're done
            if (!nextCursor || lifelogs.length < batchSize) {
                break;
            }
            
            console.log(`Fetched ${lifelogs.length} lifelogs, next cursor: ${nextCursor}`);
            cursor = nextCursor;
        } catch (error) {
            console.error("Error fetching lifelogs:", error);
            break;
        }
    }
    
    return allLifelogs;
}

// // Helper function to dedupe lifelogs
// async function dedupeLifelogs(ctx: any, lifelogs: any[]) {
//     // Get existing lifelog IDs from database
//     const existingIds = await ctx.runQuery(internal.lifelogs.getAllIds);
//     const existingIdSet = new Set(existingIds);
    
//     // Filter out duplicates/
//     return lifelogs.filter(log => !existingIdSet.has(log.id));
// }
