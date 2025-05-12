import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  LimitlessLifelog,
  convertToConvexFormat,
  LifelogRequest,
} from "../types";
import { formatDate, metadataOperation } from "../extras/utils";

// Number of lifelogs to fetch per API request

const experimentalDescendingStrategy = false;


const defaultBatchSize = 10;
const subsequentDirection = experimentalDescendingStrategy ? "desc" : "asc";
const maximumLimit = 50;

/**
 * Represents the result of a pagination operation.
 */
interface PaginationResult {
  continue: boolean;
  nextCursor?: string;
}

/**
 * Represents the API response metadata containing pagination information.
 */
interface ApiResponseMeta {
  lifelogs?: {
    nextCursor?: string;
  };
}

/**
 * Synchronizes lifelogs from the Limitless API to the Convex database.
 *
 * This action implements a smart sync strategy that adapts based on existing data:
 * - First Sync: Fetches all lifelogs in ascending order (oldest first)
 * - Subsequent Syncs: Fetches newest lifelogs in descending order until a known lifelog is found
 *
 * The function handles:
 * - Determining the appropriate sync strategy
 * - Fetching lifelogs from the Limitless API
 * - Filtering out duplicates
 * - Converting and storing new lifelogs
 * - Updating metadata with the latest sync information
 * - Logging operations for monitoring
 *
 * @returns Promise<boolean> - true if new lifelogs were added, false otherwise
 */
export const syncLimitless = internalAction({
  handler: async (ctx) => {
    // 1. Retrieve metadata about previously synced lifelogs
    const metadata = await ctx.runMutation(
      internal.extras.tests.getMetadataDoc,
    );
    const existingIdsSet = new Set<string>(metadata.lifelogIds);
    console.log(
      `Metadata: ${existingIdsSet.size} existing lifelog IDs, Synced until: ${metadata.syncedUntil ? formatDate(metadata.syncedUntil) : "N/A"}`,
    );

    // 2. Determine sync strategy
    const isFirstSync = metadata.syncedUntil === 0;
    const direction = isFirstSync ? "asc" : subsequentDirection;
    console.log(
      `Sync strategy: ${direction}`,
    );
    // 3. Fetch lifelogs using the chosen strategy
    const fetchArgs: LifelogRequest = {
      start: direction === "asc" ? new Date(metadata.endTime).toISOString() : undefined,
      direction: direction,
      includeMarkdown: true, // Always include content for now
      includeHeadings: true, // Always include headings for now
    };
    const fetchedLifelogs = await fetchLifelogs(fetchArgs, existingIdsSet);

    // 4. Process fetched lifelogs
    if (fetchedLifelogs.length === 0) {
      console.log("No new lifelogs found from API.");
      const operation = metadataOperation(
        "sync",
        `No new lifelogs found. ${existingIdsSet.size} lifelogs up to date.`,
        true,
      );
      await ctx.runMutation(internal.operations.createDocs, {
        operations: [operation],
      });
      return false;
    }

    // Ensure lifelogs are in ascending order for processing and metadata update
    const chronologicallyOrderedLifelogs =
      direction === "desc"
        ? fetchedLifelogs.reverse() // Reverse descending results
        : fetchedLifelogs; // Ascending results are already correct

    // Filter out any duplicates missed by fetchLifelogs (safeguard)
    // This shouldn't be necessary if fetchLifelogs works correctly for 'desc'
    const newLifelogs = chronologicallyOrderedLifelogs.filter(
      (log) => !existingIdsSet.has(log.id),
    );

    if (newLifelogs.length === 0) {
      console.log(
        `Fetched ${fetchedLifelogs.length} lifelogs, but all were already known duplicates.`,
      );
      // Log that we found duplicates but nothing new
      const operation = metadataOperation(
        "sync",
        `Fetched ${fetchedLifelogs.length} lifelogs, all duplicates. ${existingIdsSet.size} lifelogs up to date.`,
        true,
      );
      await ctx.runMutation(internal.operations.createDocs, {
        operations: [operation],
      });
      return false;
    }

    console.log(`Found ${newLifelogs.length} new lifelogs to add.`);

    // 5. Convert lifelogs to Convex format and store them
    const convexLifelogs = convertToConvexFormat(newLifelogs);
    const newLifelogIds = await ctx.runMutation(internal.lifelogs.createDocs, {
      lifelogs: convexLifelogs,
    });

    // 6. Update metadata table
    const newStartTime = convexLifelogs[0].startTime;
    const newEndTime = convexLifelogs[convexLifelogs.length - 1].endTime;

    const updatedStartTime = isFirstSync
      ? newStartTime
      : Math.min(metadata.startTime, newStartTime);
    const updatedEndTime = Math.max(metadata.endTime, newEndTime);
    // syncedUntil should reflect the timestamp of the latest known record
    const updatedSyncedUntil = updatedEndTime;
    const updatedLifelogIds = metadata.lifelogIds.concat(newLifelogIds);

    const operation = metadataOperation(
      "sync",
      `Added ${newLifelogs.length} new lifelogs. Total: ${updatedLifelogIds.length}.`,
      true,
    );
    await ctx.runMutation(internal.metadata.createDocs, {
      metadataDocs: [
        {
          startTime: updatedStartTime,
          endTime: updatedEndTime,
          lifelogIds: updatedLifelogIds,
          syncedUntil: updatedSyncedUntil,
        },
      ],
    });
    await ctx.runMutation(internal.operations.createDocs, {
      operations: [operation],
    });

    console.log(
      `Sync completed successfully. Added ${newLifelogs.length} lifelogs.`,
    );
    return true;
  },
});

/**
 * Fetches lifelogs from the Limitless API with pagination and optional duplicate detection.
 *
 * - First API call uses a batch size of 1, then switches to `defaultBatchSize`.
 * - If `direction` is "desc" and `existingIds` are provided, stops fetching when a duplicate ID is found.
 * - If `direction` is "asc", fetches pages until no more data is available.
 *
 * @param args - Request parameters for the API (must include 'direction').
 * @param existingIds - Set of existing lifelog IDs to detect duplicates for 'desc' fetches.
 * @returns Promise<LimitlessLifelog[]> - Array of *new* lifelogs fetched from the API.
 *                                       For 'desc' direction, these will be newest first.
 *                                       For 'asc' direction, these will be oldest first.
 */
async function fetchLifelogs(
  args: LifelogRequest,
  existingIds: Set<string>,
): Promise<LimitlessLifelog[]> {
  validateFetchParams(args);
  
  // Choose the appropriate fetch strategy based on direction
  if (args.direction === "desc") {
    // First check if the latest lifelog is a duplicate
    const isDuplicate = await checkLatestLifelogDuplicate(args, existingIds);
    if (isDuplicate) {
      console.log("Latest lifelog is a duplicate. No new lifelogs to fetch.");
      return [];
    }
    return fetchDescendingStrategy(args, existingIds);
  } else {
    return fetchAscendingStrategy(args, existingIds);
  }
}

/**
 * Validates required parameters for the fetch operation.
 */
function validateFetchParams(args: LifelogRequest): void {
  const API_KEY = process.env.LIMITLESS_API_KEY;
  if (!API_KEY) {
    console.error("LIMITLESS_API_KEY environment variable not set");
    throw new Error("LIMITLESS_API_KEY environment variable not set");
  }
  if (!args.direction) {
    throw new Error("Fetch direction ('asc' or 'desc') must be specified.");
  }
}

/**
 * Checks if the latest lifelog is already in our database.
 * This uses a single API call with batch size of 1 to efficiently check.
 */
async function checkLatestLifelogDuplicate(
  args: LifelogRequest,
  existingIds: Set<string>
): Promise<boolean> {
  const response = await makeApiRequest(args, undefined, 1);
  
  if (!response.ok) {
    await handleApiError(response);
    return false;
  }

  const data = await response.json();
  const lifelogs: LimitlessLifelog[] = data.data?.lifelogs || [];
  
  if (lifelogs.length === 0) {
    console.log("No lifelogs found in latest check.");
    return false;
  }

  const latestLifelog = lifelogs[0];
  const isDuplicate = existingIds.has(latestLifelog.id);
  
  console.log(
    `Latest lifelog check: ID ${latestLifelog.id} (endTime: ${latestLifelog.endTime ? formatDate(latestLifelog.endTime) : "N/A"}) is ${isDuplicate ? "a duplicate" : "new"}.`
  );
  
  return isDuplicate;
}

/**
 * Descending fetch strategy - fetches newest lifelogs first and stops when a duplicate is found.
 * Used for regular syncs to efficiently fetch only new lifelogs.
 */
async function fetchDescendingStrategy(
  args: LifelogRequest,
  existingIds: Set<string>
): Promise<LimitlessLifelog[]> {
  const allNewLifelogs: LimitlessLifelog[] = [];
  let cursor = args.cursor;
  let foundDuplicateInAnyBatch = false;

  while (true) {
    const batchSize = defaultBatchSize;
    const response = await makeApiRequest(args, cursor, batchSize);
    
    if (!response.ok) {
      await handleApiError(response);
      break;
    }

    const data = await response.json();
    const lifelogsInBatch: LimitlessLifelog[] = data.data?.lifelogs || [];
    const meta: ApiResponseMeta = data.meta || {};

    if (lifelogsInBatch.length === 0) {
      console.log(`No lifelogs found in this batch. Ending fetch.`);
      break;
    }

    // Process batch and check for duplicates
    const { batchToAdd, foundDuplicate } = processBatchWithDuplicateCheck(
      lifelogsInBatch, 
      existingIds
    );
    
    allNewLifelogs.push(...batchToAdd);
    
    // Track if we found a duplicate in any batch
    if (foundDuplicate) {
      foundDuplicateInAnyBatch = true;
      break;
    }

    // Check if we've reached the maximum limit
    if (allNewLifelogs.length >= maximumLimit) {
      console.log(`Reached maximum limit of ${maximumLimit} lifelogs. Stopping fetch.`);
      break;
    }

    // Handle pagination
    const paginationResult = handlePagination(
      meta,
      lifelogsInBatch.length, 
      batchSize, 
      allNewLifelogs.length, 
      args.limit
    );
    
    if (!paginationResult.continue) {
      break;
    }
    
    cursor = paginationResult.nextCursor;
  }

  // For descending strategy, only return lifelogs if we found a duplicate
  // or if we reached the maximum limit
  const finalLifelogs = foundDuplicateInAnyBatch || allNewLifelogs.length >= maximumLimit 
    ? allNewLifelogs 
    : [];

  console.log(
    `Fetch complete (descending). Returning ${finalLifelogs.length} new lifelogs.`
  );
  return finalLifelogs;
}

/**
 * Ascending fetch strategy - fetches oldest lifelogs first.
 * Used for initial syncs or fetching historical data.
 */
async function fetchAscendingStrategy(
  args: LifelogRequest,
  existingIds: Set<string>
): Promise<LimitlessLifelog[]> {
  const allNewLifelogs: LimitlessLifelog[] = [];
  let cursor = args.cursor;

  let duplicateBatches = 0;
  while (true) {
    const batchSize = defaultBatchSize;
    const response = await makeApiRequest(args, cursor, batchSize);
    
    if (!response.ok) {
      await handleApiError(response);
      break;
    }

    const data = await response.json();
    const lifelogsInBatch: LimitlessLifelog[] = data.data?.lifelogs || [];
    const meta: ApiResponseMeta = data.meta || {};

    if (lifelogsInBatch.length === 0) {
      console.log(`No lifelogs found in this batch. Ending fetch.`);
      break;
    }

    // Filter out any duplicates but continue fetching
    const newLogs = lifelogsInBatch.filter(log => !existingIds.has(log.id));
    if (newLogs.length === 0) {
      duplicateBatches++;
      if (duplicateBatches > 1) {
        console.log(`Found ${duplicateBatches} duplicate batches. Stopping fetch.`);
        break;
      }
    }
    allNewLifelogs.push(...newLogs);

    // Check if we've reached the maximum limit
    if (allNewLifelogs.length >= maximumLimit) {
      console.log(`Reached maximum limit of ${maximumLimit} lifelogs. Stopping fetch.`);
      break;
    }

    // Handle pagination
    const paginationResult = handlePagination(
      meta,
      lifelogsInBatch.length, 
      batchSize, 
      allNewLifelogs.length, 
      args.limit
    );
    
    if (!paginationResult.continue) {
      break;
    }
    
    cursor = paginationResult.nextCursor;
  }

  console.log(
    `Fetch complete (ascending). Returning ${allNewLifelogs.length} new lifelogs.`
  );
  return allNewLifelogs;
}

/**
 * Makes an API request to the Limitless API.
 */
async function makeApiRequest(
  args: LifelogRequest, 
  cursor: string | undefined, 
  batchSize: number
): Promise<Response> {
  const API_KEY = process.env.LIMITLESS_API_KEY!;
  const params: Record<string, string | number | boolean> = {
    limit: batchSize,
    includeMarkdown: args.includeMarkdown === false ? false : true,
    includeHeadings: args.includeHeadings === false ? false : true,
    direction: args.direction as string,
    timezone: args.timezone || process.env.TIMEZONE || "UTC",
  };

  if (cursor) {
    params.cursor = cursor;
  }
  if (args.direction === "asc" && args.start) {
    params.start = args.start;
  }

  // Convert params to URL query string
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      queryParams.append(key, String(value));
    }
  }

  const url = `https://api.limitless.ai/v1/lifelogs?${queryParams.toString()}`;
  console.log(`Fetching batch: ${url}`);
  
  return fetch(url, {
    headers: { "X-API-Key": API_KEY },
    method: "GET",
  });
}

/**
 * Handles API errors.
 */
async function handleApiError(response: Response): Promise<Error> {
  console.error(
    `HTTP error! Status: ${response.status}, Body: ${await response.text()}`,
  );
  return new Error(`HTTP error! Status: ${response.status}`);
}

/**
 * Processes a batch of lifelogs and checks for duplicates.
 * Returns the new lifelogs to add and whether a duplicate was found.
 */
function processBatchWithDuplicateCheck(
  lifelogsInBatch: LimitlessLifelog[],
  existingIds: Set<string>
): { batchToAdd: LimitlessLifelog[], foundDuplicate: boolean } {
  let foundDuplicate = false;
  const batchToAdd: LimitlessLifelog[] = [];

  for (const log of lifelogsInBatch) {
    if (existingIds.has(log.id)) {
      console.log(
        `Found existing lifelog ID ${log.id} (endTime: ${log.endTime ? formatDate(log.endTime) : "N/A"}). Stopping fetch.`,
      );
      foundDuplicate = true;
      break;
    }
    batchToAdd.push(log);
  }

  return { batchToAdd, foundDuplicate };
}

/**
 * Handles pagination logic.
 * Returns whether to continue fetching and the next cursor.
 * 
 * @param meta - The API response metadata containing pagination information
 * @param batchSize - The number of items received in this batch
 * @param requestedBatchSize - The number of items requested in this batch
 * @param totalFetched - The total number of items fetched so far
 * @param limit - Optional limit on the total number of items to fetch
 * @returns PaginationResult - Object indicating whether to continue and the next cursor
 */
function handlePagination(
  meta: ApiResponseMeta,
  batchSize: number,
  requestedBatchSize: number,
  totalFetched: number,
  limit?: number
): PaginationResult {
  const nextCursor = meta.lifelogs?.nextCursor;

  // Stop if there's no next cursor or if the API returned fewer results than requested
  if (!nextCursor || batchSize < requestedBatchSize) {
    console.log(
      `No next cursor or received fewer items than batch size (${batchSize}/${requestedBatchSize}). Ending fetch.`,
    );
    return { continue: false };
  }

  // Check if we've reached the requested limit
  if (limit !== undefined && totalFetched >= limit) {
    console.log(`Reached limit of ${limit} lifelogs. Stopping fetch.`);
    return { continue: false };
  }

  console.log(`Fetched ${batchSize} lifelogs, continuing with next cursor...`);
  return { continue: true, nextCursor };
}

/**
 * EXTENSION GUIDE: How to add new lifelog fetching strategies
 * 
 * This system is designed to be extensible for new fetching strategies. Follow these steps:
 * 
 * 1. Define a new strategy function with a descriptive name (e.g., fetchFilteredStrategy)
 *    The function should:
 *    - Accept common parameters (LifelogRequest and existingIds)
 *    - Return Promise<LimitlessLifelog[]>
 *    - Follow the pattern of existing strategies
 * 
 * 2. Add a condition in the fetchLifelogs function to invoke your strategy when appropriate
 *    Example:
 *    if (args.mode === "filtered") {
 *      return fetchFilteredStrategy(args, existingIds);
 *    }
 * 
 * 3. Consider extending the LifelogRequest interface in ../types.ts to include new parameters
 *    specific to your strategy (e.g., add a 'mode' field or strategy-specific options)
 * 
 * 4. Reuse existing utility functions:
 *    - makeApiRequest: For API calls with consistent parameter handling
 *    - processBatchWithDuplicateCheck: For duplicate detection
 *    - handlePagination: For pagination logic
 * 
 * 5. Ensure your strategy handles:
 *    - Error conditions properly
 *    - Logging for monitoring
 *    - Performance considerations for large datasets
 *    - Edge cases (empty results, etc.)
 */

export const runSync = internalAction({
  args: {
    sendNotification: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const isNewLifelogs: boolean = await ctx.runAction(
      internal.dashboard.sync.syncLimitless,
    );
    if (args.sendNotification === true) {
      await ctx.runAction(internal.extras.hooks.sendSlackNotification, {
        operation: "sync",
      });
    }

    return isNewLifelogs;
  },
});

export const sync = action({
  args: {
    sendNotification: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const isNewLifelogs: boolean = await ctx.runAction(
      internal.dashboard.sync.runSync,
      {
        sendNotification: args.sendNotification,
      },
    );

    return isNewLifelogs;
  },
});
