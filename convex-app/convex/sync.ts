import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, } from "./_generated/server";
import { LifelogNode } from "./lifelogs";

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
  include_headings?: boolean; // Whether to include headings, default true
  limit?: number;         // Maximum number of entries to return
}

const defaultTotalLimit = 50;
const defaultBatchSize = 10;
const defaultDirection = "asc";

// TODO: Add tracking of operations and insert into operations table
export const syncLimitless = internalAction({
    handler: async (ctx) => {
        let operations: any[] = [];
        // 1. Call internal.metadata.readLatest to get meta
        const metaList = await ctx.runQuery(internal.metadata.readLatest);
        if (metaList.length === 0) {
            console.log("No metadata found, creating default");
            const metaId = await ctx.runMutation(internal.metadata.createDefaultMeta);
            if (metaId === null) {
                const operation = {
                    operation: "sync",
                    table: "metadata",
                    success: false,
                    data: {
                        error: "Failed to create default metadata! Aborting sync.",
                    },
                };
                operations.push(operation);
                await ctx.runMutation(internal.operations.create, {
                    operations: operations,
                });
                return null;
            }
        }
        const metadata = metaList[0];
        console.log(`Metadata: ${JSON.stringify(metadata)}`);
        
        // 2. Fetch lifelogs from Limitless API
        const lifelogs = await fetchLifelogs(
            {
                start: metadata.startTime === 0 ? undefined : new Date(metadata.startTime).toISOString(),
            }
        );
        if (lifelogs.length === 0) {
            operations.push({
                operation: "sync",
                table: "metadata",
                success: false,
                data: {
                    error: "No lifelogs found. Aborting sync.",
                },
            });
            await ctx.runMutation(internal.operations.create, {
                operations: operations,
            });
            return null;
        }
        // 3. Remove duplicates from metadata
        let newLifelogs: LifelogNode[] = [];
        for (const log of lifelogs) {
            if (!metadata.lifelogIds.includes(log.id)) {
                newLifelogs.push(log);
            }
        }
        if (newLifelogs.length === 0) {
            operations.push({
                operation: "sync",
                table: "metadata",
                success: false,
                data: {
                    error: `All ${lifelogs.length} fetched lifelogs are duplicates.`,
                },
            });
            await ctx.runMutation(internal.operations.create, {
                operations: operations,
            });
            return null;
        } else {
            console.log(`Found ${newLifelogs.length} new lifelogs to add.`);
        }
        
        // 4. Convert lifelogs to Convex format
        const convexLifelogs = newLifelogs.map(log => {
            if (!log.startTime || !log.endTime) {
                throw new Error(`Lifelog ${log.id} is missing required time fields`);
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
        
        // 5. Update metadata table
        if (lifelogs.length > 0) {
            await ctx.runMutation(internal.metadata.create, {
                meta: {
                    startTime: metadata.startTime === 0 ? convexLifelogs[0].startTime : metadata.startTime,
                    endTime: convexLifelogs[convexLifelogs.length - 1].endTime,
                    lifelogIds: metadata.lifelogIds.concat(lifelogIds),
                    syncedUntil: convexLifelogs[convexLifelogs.length - 1].endTime
                    // NOTE: If we ever need to sync in descending order, we should ensure this isn't backwards
                }
            });
        }
        
        // 6. Report operations to the operations table
        operations.push({
            operation: "sync",
            table: "metadata",
            success: true,
            data: {
                lifelogsProcessed: lifelogs.length,
                lifelogsAdded: lifelogIds.length
            },
        });
        await ctx.runMutation(internal.operations.create, {
            operations: operations,
        });
    },
});

// Helper function to fetch lifelogs from the Limitless API
async function fetchLifelogs(args: LifelogRequest) {
    const API_KEY = process.env.LIMITLESS_API_KEY;
    if (!API_KEY) {
        console.log('No api key.')
        throw new Error("LIMITLESS_API_KEY environment variable not set");
    }
    
    const allLifelogs: LifelogNode[] = [];
    let cursor = args.cursor;
    const limit = args.limit || defaultTotalLimit;
    let batchSize = args.limit || defaultBatchSize;
    
    // If limit is not null, set a batch size and fetch until we reach the limit
    if (limit !== null) {
        batchSize = Math.min(batchSize, limit);
    }
    
    while (true) {
        const params: LifelogRequest = {
            limit: batchSize,
            include_markdown: args.include_markdown === false ? false : true,
            include_headings: args.include_headings === false ? false : true,
            direction: args.direction || defaultDirection,
            timezone: args.timezone || process.env.TIMEZONE
        };
        // Add start only if it's not null
        if (args.start) {
            params.start = args.start;
        }
        // Add cursor for pagination if we have one
        if (cursor) {
            params.cursor = cursor;
        }
        
        console.log(`Fetching lifelogs with params: ${JSON.stringify(params)}`);
        
        // Convert params to URL query string
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                queryParams.append(key, String(value));
            }
        }
        
        try {
            const url = `https://api.limitless.ai/v1/lifelogs?${queryParams.toString()}`;
            const response = await fetch(url, {
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
            if (limit && allLifelogs.length >= limit) {
                return allLifelogs.slice(0, limit);
            }
            
            // Get the next cursor from the response
            const nextCursor = data.meta?.lifelogs?.nextCursor;
            
            // If there's no next cursor or we got fewer results than requested, we're done
            if (!nextCursor || lifelogs.length < batchSize) {
                break;
            }
            
            console.log(`Fetched ${lifelogs.length} lifelogs and received cursor`);
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
