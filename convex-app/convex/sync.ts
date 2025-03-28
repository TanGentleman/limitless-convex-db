import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { LimitlessLifelog, convertToConvexFormat } from "./types";
import { formatDate, metadataOperation } from "./extras/utils";

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
        // 1. Retrieve metadata about previously synced lifelogs
        const metadata = await ctx.runMutation(internal.extras.tests.getMetadataDoc);
        console.log(`Metadata: ${metadata.lifelogIds.length} existing lifelog IDs, Synced until: ${metadata.syncedUntil ? formatDate(metadata.syncedUntil) : "N/A"}`);
        
        // 1.5 Try a partial sync
        const partialLifelogs = await fetchLifelogs({
            limit: 10,
            direction: "desc",
            include_markdown: true,
            include_headings: true
        });
        
        // Filter duplicates from partial sync
        const newPartialLifelogs = filterDuplicateLifelogs(partialLifelogs, metadata.lifelogIds);
        
        // Handle partial sync results
        if (newPartialLifelogs.length === 0) {
            // No new lifelogs found, sync not needed
            const operation = metadataOperation("sync", `${metadata.lifelogIds.length} lifelogs up to date.`, true);
            await ctx.runMutation(internal.operations.createDocs, {
                operations: [operation],
            });
            return false;
        } else if (newPartialLifelogs.length < 10) {
            // Process the partial list of new lifelogs in ascending order
            const convexLifelogs = convertToConvexFormat(newPartialLifelogs.reverse());
            const lifelogIds = await ctx.runMutation(internal.lifelogs.createDocs, {
                lifelogs: convexLifelogs
            });
            
            // Update metadata
            const operation = metadataOperation("sync", `Synced ${newPartialLifelogs.length} new lifelogs`, true);
            await ctx.runMutation(internal.metadata.createDocs, {
                metadataDocs: [{
                    startTime: metadata.startTime === 0 ? convexLifelogs[0].startTime : metadata.startTime,
                    endTime: convexLifelogs[convexLifelogs.length - 1].endTime,
                    lifelogIds: metadata.lifelogIds.concat(lifelogIds),
                    syncedUntil: Math.max(metadata.syncedUntil, convexLifelogs[convexLifelogs.length - 1].endTime)
                }]
            });
            await ctx.runMutation(internal.operations.createDocs, {
                operations: [operation],
            });
            return true;
        }
        
        // If we got 10 items, proceed with full sync
        const lifelogRequest: LifelogRequest = {
            start: metadata.startTime === 0 ? undefined : new Date(metadata.syncedUntil).toISOString(),
        }
        const lifelogs = await fetchLifelogs(lifelogRequest);

        // Filter duplicates from full sync
        const newLifelogs = filterDuplicateLifelogs(lifelogs, metadata.lifelogIds);
        
        if (newLifelogs.length === 0) {
            const operation = metadataOperation("sync", `All ${lifelogs.length} fetched lifelogs are duplicates.`, false);
            await ctx.runMutation(internal.operations.createDocs, {
                operations: [operation],
            });
            return false;
        } else {
            console.log(`Found ${newLifelogs.length} new lifelogs to add.`);
        }
        
        // Convert lifelogs to Convex format and store them
        const convexLifelogs = convertToConvexFormat(newLifelogs);
        const lifelogIds = await ctx.runMutation(internal.lifelogs.createDocs, {
            lifelogs: convexLifelogs
        });
        
        // Update metadata table
        if (lifelogs.length > 0) {
            const operation = metadataOperation("sync", `Synced ${lifelogs.length} lifelogs, added ${lifelogIds.length} new lifelogs`, true);
            await ctx.runMutation(internal.metadata.createDocs, {
                metadataDocs: [{
                    startTime: metadata.startTime === 0 ? convexLifelogs[0].startTime : metadata.startTime,
                    endTime: convexLifelogs[convexLifelogs.length - 1].endTime,
                    lifelogIds: metadata.lifelogIds.concat(lifelogIds),
                    syncedUntil: Math.max(metadata.syncedUntil, convexLifelogs[convexLifelogs.length - 1].endTime)
                }]
            });
            await ctx.runMutation(internal.operations.createDocs, {
                operations: [operation],
            });
        }
        
        console.log("Sync completed successfully");
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
function filterDuplicateLifelogs(lifelogs: LimitlessLifelog[], existingIds: string[]): LimitlessLifelog[] {
    return lifelogs.filter(log => !existingIds.includes(log.id));
}


/**
 * Fetches lifelogs from the Limitless API with pagination support.
 * 
 * @param args - Request parameters for the API
 * @param optionalExistingIds - Optional array of existing IDs for duplicate detection
 * @returns Promise<LimitlessLifelog[]> - Array of lifelogs from the API
 */
async function fetchLifelogs(args: LifelogRequest, optionalExistingIds: string[] = []) {
    const API_KEY = process.env.LIMITLESS_API_KEY;
    if (!API_KEY) {
        console.log('No api key.')
        throw new Error("LIMITLESS_API_KEY environment variable not set");
    }
    
    const allLifelogs: LimitlessLifelog[] = [];
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
            const lifelogs: LimitlessLifelog[] = data.data?.lifelogs || [];

            if (lifelogs.length === 0) {
                console.log(`No lifelogs found in this batch.`);
                break;
            }
            
            // Check if the last lifelog is a duplicate
            if (optionalExistingIds) {
              const lastLifelog = lifelogs[lifelogs.length - 1];
              if (optionalExistingIds.includes(lastLifelog.id)) {
                console.log(`Dupe! End time: ${lastLifelog.endTime ? formatDate(lastLifelog.endTime) : "N/A"}`);
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
