import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { LimitlessLifelog, convertToConvexFormat } from "./types";
import { formatDate, metadataOperation } from "./extras/utils";

/**
 * Request parameters for retrieving lifelogs.
 * Matches the Limitless API query parameters.
 * Note: 'limit' is handled internally by fetchLifelogs batching.
 * Note: 'start'/'end' might not be needed with the new sync logic.
 */
export type LifelogRequest = {
  timezone?: string;      // IANA timezone specifier. Default: UTC
  date?: string;          // Format: YYYY-MM-DD - Ignored, use start/end.
  start?: string;         // ISO-8601 format - Handled by sync logic based on metadata
  end?: string;           // ISO-8601 format - Handled by sync logic based on metadata
  cursor?: string;        // Cursor for pagination
  direction?: "asc" | "desc"; // Sort direction. Required by fetchLifelogs.
  include_markdown?: boolean; // Include markdown content. Default: true
  include_headings?: boolean; // Include headings. Default: true
  limit?: number;         // Maximum entries to return - Handled internally
}

// const defaultTotalLimit = 50; // No longer used, fetch continues until duplicate or end
const defaultBatchSize = 10; // Limitless API default/max might be different, but 10 is reasonable.

/**
 * Synchronizes lifelogs from Limitless API to the Convex database.
 *
 * Determines sync strategy based on existing data:
 * - First Sync: Fetches all lifelogs in ascending order.
 * - Subsequent Syncs: Fetches newest lifelogs in descending order until a known lifelog is found.
 *
 * Stores new lifelogs, updates metadata, and logs operations.
 *
 * @returns Promise<boolean> - true if new lifelogs were added, false otherwise
 */
export const syncLimitless = internalAction({
    handler: async (ctx) => {
        // 1. Retrieve metadata about previously synced lifelogs
        const metadata = await ctx.runMutation(internal.extras.tests.getMetadataDoc);
        const existingIdsSet = new Set(metadata.lifelogIds);
        console.log(`Metadata: ${existingIdsSet.size} existing lifelog IDs, Synced until: ${metadata.syncedUntil ? formatDate(metadata.syncedUntil) : "N/A"}`);

        // 2. Determine sync strategy
        const isFirstSync = metadata.syncedUntil === 0;
        const direction = isFirstSync ? "asc" : "desc";
        console.log(`Sync strategy: ${isFirstSync ? 'First sync (asc)' : 'Subsequent sync (desc)'}`);

        // 3. Fetch lifelogs using the chosen strategy
        const fetchArgs: LifelogRequest = {
            direction: direction,
            include_markdown: true, // Always include content for now
            include_headings: true, // Always include headings for now
        };
        const fetchedLifelogs = await fetchLifelogs(fetchArgs, existingIdsSet);

        // 4. Process fetched lifelogs
        if (fetchedLifelogs.length === 0) {
            console.log("No new lifelogs found from API.");
            const operation = metadataOperation("sync", `No new lifelogs found. ${existingIdsSet.size} lifelogs up to date.`, true);
            await ctx.runMutation(internal.operations.createDocs, { operations: [operation] });
            return false;
        }

        // Ensure lifelogs are in ascending order for processing and metadata update
        const chronologicallyOrderedLifelogs = direction === "desc"
            ? fetchedLifelogs.reverse() // Reverse descending results
            : fetchedLifelogs; // Ascending results are already correct

        // Filter out any duplicates missed by fetchLifelogs (safeguard)
        // This shouldn't be necessary if fetchLifelogs works correctly for 'desc'
        const newLifelogs = chronologicallyOrderedLifelogs.filter(log => !existingIdsSet.has(log.id));

        if (newLifelogs.length === 0) {
            console.log(`Fetched ${fetchedLifelogs.length} lifelogs, but all were already known duplicates.`);
            // Log that we found duplicates but nothing new
             const operation = metadataOperation("sync", `Fetched ${fetchedLifelogs.length} lifelogs, all duplicates. ${existingIdsSet.size} lifelogs up to date.`, true);
             await ctx.runMutation(internal.operations.createDocs, { operations: [operation] });
            return false;
        }

        console.log(`Found ${newLifelogs.length} new lifelogs to add.`);

        // 5. Convert lifelogs to Convex format and store them
        const convexLifelogs = convertToConvexFormat(newLifelogs);
        const newLifelogIds = await ctx.runMutation(internal.lifelogs.createDocs, {
            lifelogs: convexLifelogs
        });

        // 6. Update metadata table
        const newStartTime = convexLifelogs[0].startTime;
        const newEndTime = convexLifelogs[convexLifelogs.length - 1].endTime;

        const updatedStartTime = isFirstSync ? newStartTime : Math.min(metadata.startTime, newStartTime);
        const updatedEndTime = Math.max(metadata.endTime, newEndTime);
        // syncedUntil should reflect the timestamp of the latest known record
        const updatedSyncedUntil = updatedEndTime;
        const updatedLifelogIds = metadata.lifelogIds.concat(newLifelogIds);

        const operation = metadataOperation("sync", `Added ${newLifelogs.length} new lifelogs. Total: ${updatedLifelogIds.length}.`, true);
        await ctx.runMutation(internal.metadata.createDocs, {
            metadataDocs: [{
                startTime: updatedStartTime,
                endTime: updatedEndTime,
                lifelogIds: updatedLifelogIds,
                syncedUntil: updatedSyncedUntil
            }]
        });
        await ctx.runMutation(internal.operations.createDocs, {
            operations: [operation],
        });

        console.log(`Sync completed successfully. Added ${newLifelogs.length} lifelogs.`);
        return true;
    },
});

/**
 * Fetches lifelogs from the Limitless API with pagination and optional duplicate detection.
 *
 * - Fetches in batches using `defaultBatchSize`.
 * - If `direction` is "desc" and `existingIds` are provided, stops fetching when a duplicate ID is found.
 * - If `direction` is "asc", fetches pages until no more data is available.
 *
 * @param args - Request parameters for the API (must include 'direction').
 * @param existingIds - Set of existing lifelog IDs to detect duplicates for 'desc' fetches.
 * @returns Promise<LimitlessLifelog[]> - Array of *new* lifelogs fetched from the API.
 *                                       For 'desc' direction, these will be newest first.
 *                                       For 'asc' direction, these will be oldest first.
 */
async function fetchLifelogs(args: LifelogRequest, existingIds: Set<string>): Promise<LimitlessLifelog[]> {
    const API_KEY = process.env.LIMITLESS_API_KEY;
    if (!API_KEY) {
        console.error("LIMITLESS_API_KEY environment variable not set");
        throw new Error("LIMITLESS_API_KEY environment variable not set");
    }
    if (!args.direction) {
         throw new Error("Fetch direction ('asc' or 'desc') must be specified.");
    }

    const allNewLifelogs: LimitlessLifelog[] = [];
    let cursor = args.cursor;
    const batchSize = defaultBatchSize; // Use fixed batch size for pagination

    while (true) {
        const params: Record<string, string | number | boolean> = {
            limit: batchSize,
            include_markdown: args.include_markdown === false ? false : true,
            include_headings: args.include_headings === false ? false : true,
            direction: args.direction,
            timezone: args.timezone || process.env.TIMEZONE || "UTC"
        };

        if (cursor) {
            params.cursor = cursor;
        }

        // Convert params to URL query string
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            // Skip undefined values, handle boolean conversion
             if (value !== undefined) {
                queryParams.append(key, String(value));
            }
        }

        try {
            const url = `https://api.limitless.ai/v1/lifelogs?${queryParams.toString()}`;
            console.log(`Fetching batch: ${url}`);
            const response = await fetch(url, {
                headers: { "X-API-Key": API_KEY },
                method: "GET",
            });

            if (!response.ok) {
                console.error(`HTTP error! Status: ${response.status}, Body: ${await response.text()}`);
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            const lifelogsInBatch: LimitlessLifelog[] = data.data?.lifelogs || [];

            if (lifelogsInBatch.length === 0) {
                console.log(`No lifelogs found in this batch. Ending fetch.`);
                break; // No more data from API
            }

            let foundDuplicateInBatch = false;
            const batchToAdd: LimitlessLifelog[] = [];

            if (args.direction === "desc" && existingIds.size > 0) {
                // Check for duplicates only in descending syncs
                for (const log of lifelogsInBatch) {
                    if (existingIds.has(log.id)) {
                        console.log(`Found existing lifelog ID ${log.id} (endTime: ${log.endTime ? formatDate(log.endTime) : 'N/A'}). Stopping fetch.`);
                        foundDuplicateInBatch = true;
                        break; // Stop processing this batch
                    }
                    batchToAdd.push(log); // Add if not a duplicate
                }
            } else {
                // Ascending sync or no existing IDs, add all from batch
                batchToAdd.push(...lifelogsInBatch);
            }

            // Add the verified new logs from this batch
            allNewLifelogs.push(...batchToAdd);

            // Stop pagination if a duplicate was found in 'desc' mode
            if (foundDuplicateInBatch) {
                break;
            }

            // Get the next cursor for pagination
            const nextCursor = data.meta?.lifelogs?.nextCursor;

            // Stop if there's no next cursor or if the API returned fewer results than requested
            if (!nextCursor || lifelogsInBatch.length < batchSize) {
                 console.log(`No next cursor or received fewer items than batch size (${lifelogsInBatch.length}/${batchSize}). Ending fetch.`);
                break;
            }

            console.log(`Fetched ${lifelogsInBatch.length} lifelogs, continuing with next cursor...`);
            cursor = nextCursor;

        } catch (error) {
            console.error("Error fetching lifelogs batch:", error);
            // Depending on the error, might want to retry or handle differently
            break; // Stop fetching on error
        }
    }

    console.log(`Fetch complete. Returning ${allNewLifelogs.length} new lifelogs.`);
    return allNewLifelogs;
}
