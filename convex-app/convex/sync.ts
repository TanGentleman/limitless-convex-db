import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { LifelogNode, convertToConvexFormat } from "./types";

/**
 * Request parameters for retrieving lifelogs.
 * Matches the Limitless API query parameters.
 */
export type LifelogRequest = {
  timezone?: string;      // IANA timezone specifier. Default: UTC
  date?: string;          // Format: YYYY-MM-DD
  start?: string;         // ISO-8601 format (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS)
  end?: string;           // ISO-8601 format (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS)
  cursor?: string;        // Cursor for pagination
  direction?: "asc" | "desc"; // Sort direction. Default: "desc"
  include_markdown?: boolean; // Include markdown content. Default: true
  include_headings?: boolean; // Include headings. Default: true
  limit?: number;         // Maximum entries to return
}

const defaultTotalLimit = 50;
const defaultBatchSize = 10;
const defaultDirection = "asc";

/**
 * Synchronizes lifelogs from Limitless API to the Convex database.
 * 
 * Fetches new lifelogs, filters duplicates, and stores them in the database.
 * Updates metadata with sync information and logs operations.
 * 
 * @returns Promise<boolean> - true if new lifelogs were added, false otherwise
 */
export const syncLimitless = internalAction({
    handler: async (ctx) => {
        let operations: any[] = [];
        
        // 1. Retrieve metadata about previously synced lifelogs
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
                return false;
            }
        }
        const metadata = metaList[0];
        console.log(`Metadata: ${metadata.lifelogIds.length} existing lifelog IDs, Synced until: ${metadata.syncedUntil ? new Date(metadata.syncedUntil).toISOString() : "N/A"}`);
        
        // 2. Check if new lifelogs are available
        const refreshNeeded = await isRefreshNeeded(metadata.lifelogIds);
        console.log(`Refresh needed: ${refreshNeeded}`);
        if (!refreshNeeded) {
            // Optional: Schedule the next sync in 30 minutes
            // await ctx.scheduler.runAfter(1800000, internal.sync.syncLimitless, {});
            
            // Log successful operation
            operations.push({
                operation: "sync",
                table: "metadata",
                success: true,
                data: {
                    message: "No changes needed, sync completed successfully.",
                }
            });
            
            await ctx.runMutation(internal.operations.create, {
                operations: operations,
            });
            return false;
        }
        
        // 3. Fetch lifelogs from Limitless API
        const lifelogRequest: LifelogRequest = {
            start: metadata.startTime === 0 ? undefined : new Date(metadata.syncedUntil).toISOString(),
        }
        const lifelogs = await fetchLifelogs(lifelogRequest, metadata.lifelogIds);

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
            return false;
        }
        
        // 4. Filter out duplicates
        const newLifelogs = filterDuplicateLifelogs(lifelogs, metadata.lifelogIds);
        
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
            return false;
        } else {
            console.log(`Found ${newLifelogs.length} new lifelogs to add.`);
        }
        
        // 5. Convert lifelogs to Convex format and store them
        const convexLifelogs = convertToConvexFormat(newLifelogs);
        const lifelogIds = await ctx.runMutation(internal.lifelogs.create, {
            lifelogs: convexLifelogs
        });
        
        // 6. Update metadata table
        if (lifelogs.length > 0) {
            await ctx.runMutation(internal.metadata.create, {
                meta: {
                    startTime: metadata.startTime === 0 ? convexLifelogs[0].startTime : metadata.startTime,
                    endTime: convexLifelogs[convexLifelogs.length - 1].endTime,
                    lifelogIds: metadata.lifelogIds.concat(lifelogIds),
                    syncedUntil: Math.max(metadata.syncedUntil, convexLifelogs[convexLifelogs.length - 1].endTime)
                    // NOTE: If we ever need to sync in descending order, we should ensure this isn't backwards
                }
            });
        }
        
        // 7. Record operations for logging
        operations.push({
            operation: "sync",
            table: "metadata",
            success: true,
            data: {
                message: `Synced ${lifelogs.length} lifelogs, added ${lifelogIds.length} new lifelogs`,
            },
        });
        await ctx.runMutation(internal.operations.create, {
            operations: operations,
        });
        console.log(`Sync completed with ${operations.length} operations`);
        return true;
    },
});

/**
 * Checks if a refresh is needed by comparing latest lifelog with existing IDs.
 * 
 * @param existingIds - Array of existing lifelog IDs
 * @returns Promise<boolean|null> - true if new lifelogs available, false if not, null on error
 */
async function isRefreshNeeded(existingIds: string[]): Promise<boolean | null> {
    try {
        // If we have no existing lifelogs, we definitely need a refresh
        if (existingIds.length === 0) {
            console.log("No existing lifelogs found! Refresh needed.");
            return true;
        }
        
        // Fetch only the most recent lifelog for efficiency
        const lifelogs = await fetchLifelogs({
            limit: 1,
            direction: "desc", // Get the newest one
            include_markdown: false, // Skip content for faster response
            include_headings: false, // Skip headings for faster response
        });
        
        // If no lifelogs returned, no refresh needed
        if (lifelogs.length === 0) return false;
        
        // Check if the latest lifelog is already in our database
        return !existingIds.includes(lifelogs[0].id);
    } catch (error) {
        console.error("Error checking for refresh.:", error);
        // On error, assume no refresh is needed to prevent potential issues
        return null;
    }
}

/**
 * Filters out duplicate lifelogs that already exist in the database.
 * 
 * @param lifelogs - Array of lifelogs to filter
 * @param existingIds - Array of existing lifelog IDs
 * @returns Array of new lifelogs
 */
function filterDuplicateLifelogs(lifelogs: LifelogNode[], existingIds: string[]): LifelogNode[] {
    return lifelogs.filter(log => !existingIds.includes(log.id));
}


/**
 * Fetches lifelogs from the Limitless API with pagination support.
 * 
 * @param args - Request parameters for the API
 * @param optionalExistingIds - Optional array of existing IDs for duplicate detection
 * @returns Promise<LifelogNode[]> - Array of lifelogs from the API
 */
async function fetchLifelogs(args: LifelogRequest, optionalExistingIds: string[] = []) {
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
            timezone: args.timezone || process.env.TIMEZONE || "UTC"
        };
        
        if (args.start !== undefined) {
            params.start = args.start;
        }
        
        if (cursor) {
            params.cursor = cursor;
        }
        
        // Convert params to URL query string
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                queryParams.append(key, String(value));
            }
        }
        
        try {
            const url = `https://api.limitless.ai/v1/lifelogs?${queryParams.toString()}`;
            console.log(`API Request: ${url}`);
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

            if (lifelogs.length === 0) {
                console.log(`No lifelogs found in this batch.`);
                break;
            }
            
            // Check if the last lifelog is a duplicate
            if (optionalExistingIds) {
              const lastLifelog = lifelogs[lifelogs.length - 1];
              if (optionalExistingIds.includes(lastLifelog.id)) {
                console.log(`Dupe! End time: ${lastLifelog.endTime ? new Date(lastLifelog.endTime).toISOString() : "N/A"}`);
              }
            }
            
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
