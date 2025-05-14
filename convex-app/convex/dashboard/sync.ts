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

// ================================================================================
// CONFIGURATION
// ================================================================================

/**
 * Configuration constants for lifelog synchronization.
 */
const CONFIG = {
  /** Number of lifelogs to fetch per API request */
  defaultBatchSize: 10,
  /** Maximum number of lifelogs to fetch per sync */
  maximumLimit: 50,
  /** Maximum consecutive duplicate batches before stopping */
  maxDuplicateBatches: 3,
  /** Maximum API calls per sync operation */
  maxApiCalls: 10,
  /** Whether to use descending strategy by default for non-first syncs */
  experimentalDescendingStrategy: false,
  /** Whether to use date parameter instead of start for ascending strategy */
  experimentalReplaceAscParams: true,
  /** Whether to perform a preliminary check before full descending sync */
  runPreliminarySync: true
};

// ================================================================================
// TYPES AND INTERFACES
// ================================================================================

/**
 * Represents the result of a pagination operation.
 */
interface PaginationResult {
  /** Whether to continue fetching more pages */
  continue: boolean;
  /** Cursor for the next page of results */
  nextCursor?: string;
  /** Whether all data for the current date has been fetched */
  dateIsDone?: boolean;
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
 * Represents the result of a fetch operation.
 */
interface FetchResult {
  /** The lifelogs fetched from the API */
  lifelogs: LimitlessLifelog[];
  /** Whether the fetch operation was successful */
  success: boolean;
  /** Message describing the result */
  message: string;
}

// ================================================================================
// API INTERACTION FUNCTIONS
// ================================================================================

/**
 * Makes an API request to the Limitless API.
 * 
 * @param args - Base request parameters
 * @param cursor - Pagination cursor
 * @param batchSize - Number of items to fetch
 * @returns Promise<Response> - The API response
 */
async function makeApiRequest(
  args: LifelogRequest, 
  cursor: string | undefined, 
  batchSize: number
): Promise<Response> {
  const params: LifelogRequest = {
    limit: batchSize,
    includeMarkdown: args.includeMarkdown === false ? false : true,
    includeHeadings: args.includeHeadings === false ? false : true,
    direction: args.direction,
    timezone: args.timezone || process.env.TIMEZONE || "UTC",
  };

  if (cursor) {
    params.cursor = cursor;
  }
  
  if (args.direction === "asc" && CONFIG.experimentalReplaceAscParams && args.start ) {
    params.date = new Date(args.start).toISOString().split('T')[0]
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
    headers: { "X-API-Key": process.env.LIMITLESS_API_KEY! },
    method: "GET",
  });
}

/**
 * Handles API errors and logs appropriate messages.
 * 
 * @param response - The API response
 * @returns Promise<number> - The HTTP status code
 */
async function handleApiError(response: Response): Promise<number> {
  if (response.status === 504) {
    console.error("HTTP error! Timeout. Please try again later.");
    return 504;
  }
  if (response.status === 500) {
    console.error("HTTP error! Limitless server. Check params!");
    return 500;
  }
  console.error(
    `HTTP error! Status: ${response.status}, Body: ${await response.text()}`,
  );
  return response.status;
}

// ================================================================================
// UTILITY FUNCTIONS
// ================================================================================

/**
 * Validates required parameters for the fetch operation.
 * 
 * @param args - The request parameters to validate
 * @throws Error if required parameters are missing
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
 * Processes a batch of lifelogs and checks for duplicates.
 * Returns the new lifelogs to add and whether a duplicate was found.
 * 
 * @param lifelogsInBatch - Batch of lifelogs to process
 * @param existingIds - Set of existing lifelog IDs to detect duplicates
 * @returns Object containing new lifelogs and duplicate flag
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
 * 
 * @param meta - API response metadata containing pagination information
 * @param batchSize - Number of items received in this batch
 * @param requestedBatchSize - Number of items requested in this batch
 * @param totalFetched - Total number of items fetched so far
 * @param limit - Optional limit on total items to fetch
 * @returns PaginationResult - Object with pagination details
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
  if (batchSize < requestedBatchSize) {
    console.log(
      `Received fewer items than batch size (${batchSize}/${requestedBatchSize}). Ending fetch.`,
    );
    return { continue: false, dateIsDone: true };
  }
  
  if (!nextCursor) {
    console.log(`No next cursor. Ending fetch.`);
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

// ================================================================================
// DESCENDING STRATEGY IMPLEMENTATION
// ================================================================================

/**
 * Checks if the latest lifelog is already in our database.
 * This uses a single API call with batch size of 1 to efficiently check.
 * 
 * @param args - Request parameters
 * @param existingIds - Set of existing lifelog IDs
 * @returns Promise<boolean> - Whether the latest lifelog is a duplicate
 */
async function checkLatestLifelogDuplicate(
  args: LifelogRequest,
  existingIds: Set<string>
): Promise<boolean> {
  args.includeMarkdown = false;
  args.includeHeadings = false;
  const batchSize = 1;
  const response = await makeApiRequest(args, undefined, batchSize);
  
  if (!response.ok) {
    await handleApiError(response);
    throw new Error("Failed to check latest lifelog duplicate.");
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
 * 
 * Success condition: A duplicate lifelog must be found to save the results.
 * This ensures we've found all new lifelogs since the last sync.
 * 
 * @param args - Request parameters
 * @param existingIds - Set of existing lifelog IDs
 * @returns Promise<FetchResult> - The fetch result with lifelogs and status
 */
async function fetchDescendingStrategy(
  args: LifelogRequest,
  existingIds: Set<string>
): Promise<FetchResult> {
  const allNewLifelogs: LimitlessLifelog[] = [];
  let cursor = args.cursor;
  let foundDuplicateInAnyBatch = false;
  let apiCalls = 0;
  
  while (apiCalls < CONFIG.maxApiCalls) {
    const batchSize = CONFIG.defaultBatchSize;
    const response = await makeApiRequest(args, cursor, batchSize);
    apiCalls++;
    
    if (!response.ok) {
      await handleApiError(response);
      return {
        lifelogs: [],
        success: false,
        message: "Failed to fetch descending lifelogs."
      };
    }

    const data = await response.json();
    const lifelogsInBatch: LimitlessLifelog[] = data.data?.lifelogs || [];
    const meta: ApiResponseMeta = data.meta || {};

    if (lifelogsInBatch.length === 0) {
      console.log(`No lifelogs found in this desc batch. Ending fetch.`);
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
    if (allNewLifelogs.length >= CONFIG.maximumLimit) {
      return {
        lifelogs: [],
        success: false,
        message: `Unsuccessful sync. Do not try this strategy with ${CONFIG.maximumLimit}+ pending lifelogs.`
      };
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

  // In descending strategy, return results only if we found a duplicate or reached the limit
  const foundEndOfNewData = foundDuplicateInAnyBatch || allNewLifelogs.length >= CONFIG.maximumLimit;
  
  return {
    lifelogs: foundEndOfNewData ? allNewLifelogs : [],
    success: foundEndOfNewData,
    message: foundDuplicateInAnyBatch 
      ? `Found ${allNewLifelogs.length} new lifelogs until duplicate.`
      : allNewLifelogs.length >= CONFIG.maximumLimit 
        ? `Reached limit of ${CONFIG.maximumLimit} lifelogs without finding duplicate.`
        : `Incomplete sync: No duplicate found. Sync not saved.`
  };
}

// ================================================================================
// ASCENDING STRATEGY IMPLEMENTATION
// ================================================================================

/**
 * Ascending fetch strategy - fetches oldest lifelogs first.
 * Used for initial syncs or fetching historical data.
 * 
 * Success condition: The database should be up to date. 
 * If experimentalReplaceAscParams is enabled, a full day's
 * data should be complete.
 * 
 * @param args - Request parameters
 * @param existingIds - Set of existing lifelog IDs
 * @returns Promise<FetchResult> - The fetch result with lifelogs and status
 */
async function fetchAscendingStrategy(
  args: LifelogRequest,
  existingIds: Set<string>
): Promise<FetchResult> {
  const allNewLifelogs: LimitlessLifelog[] = [];
  let cursor = args.cursor;
  let duplicateBatches = 0;
  let apiCalls = 0;
  
  while (apiCalls < CONFIG.maxApiCalls) {
    const batchSize = CONFIG.defaultBatchSize;
    const response = await makeApiRequest(args, cursor, batchSize);
    apiCalls++;
    
    if (!response.ok) {
      await handleApiError(response);
      return {
        lifelogs: [],
        success: false,
        message: "Failed to fetch ascending lifelogs."
      };
    }

    const data = await response.json();
    const lifelogsInBatch: LimitlessLifelog[] = data.data?.lifelogs || [];
    const meta: ApiResponseMeta = data.meta || {};

    if (lifelogsInBatch.length === 0) {
      console.log(`No lifelogs found in this asc batch.`);
      if (CONFIG.experimentalReplaceAscParams && args.start) {
        console.log(`Incrementing date by 24 hours.`);
        console.log("This is experimental and has side effects.");
        const newDate = new Date(args.start);
        newDate.setDate(newDate.getDate() + 1);
        args.start = newDate.toISOString();
        args.cursor = undefined;
        continue;
      }
      break;
    }

    // Filter out any duplicates but continue fetching
    const newLogs = lifelogsInBatch.filter(log => !existingIds.has(log.id));
    if (newLogs.length === 0) {
      duplicateBatches++;
      if (duplicateBatches > CONFIG.maxDuplicateBatches) {
        console.log(`Found ${duplicateBatches} duplicate batches. Stopping fetch.`);
        break;
      }
    }
    allNewLifelogs.push(...newLogs);

    // Check if we've reached the maximum limit
    if (allNewLifelogs.length >= CONFIG.maximumLimit) {
      console.log(`Reached maximum limit of ${CONFIG.maximumLimit} lifelogs. Stopping fetch.`);
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

    if (paginationResult.dateIsDone) {
      if (allNewLifelogs.length === 0 && CONFIG.experimentalReplaceAscParams && args.start) {
        console.log("This is experimental and has side effects.");
        console.log("Incrementing date by 24 hours.");
        // increment date by 24 hours
        const newDate = new Date(args.start);
        newDate.setDate(newDate.getDate() + 1);
        args.start = newDate.toISOString();
        args.cursor = undefined;
        continue;
      }
      console.log(`Date is done. Ending fetch.`);
      break;
    }

    if (!paginationResult.continue) {
      break;
    }
    
    cursor = paginationResult.nextCursor;
  }

  return {
    lifelogs: allNewLifelogs,
    success: true,
    message: `Fetch complete (ascending). Retrieved ${allNewLifelogs.length} new lifelogs.`
  };
}

// ================================================================================
// MAIN SYNC LOGIC
// ================================================================================

/**
 * Fetches lifelogs from the Limitless API with pagination and optional duplicate detection.
 *
 * - If `direction` is "desc", stops fetching when a duplicate ID is found.
 * - If `direction` is "asc", fetches pages until no more data is available.
 *
 * @param args - Request parameters for the API (must include 'direction').
 * @param existingIds - Set of existing lifelog IDs to detect duplicates.
 * @returns Promise<LimitlessLifelog[]> - Array of *new* lifelogs fetched from the API.
 *                                       For 'desc' direction, these will be newest first.
 *                                       For 'asc' direction, these will be oldest first.
 */
async function fetchLifelogs(
  args: LifelogRequest,
  existingIds: Set<string>
): Promise<LimitlessLifelog[]> {
  validateFetchParams(args);
  
  if (args.direction === undefined) {
    throw new Error("Fetch direction ('asc' or 'desc') must be specified.");
  }
  

  
  // Choose the appropriate fetch strategy based on direction
  if (args.direction === "desc") {
    // First check if the latest lifelog is a duplicate
    if (CONFIG.runPreliminarySync) {
      const isDuplicate = await checkLatestLifelogDuplicate(args, existingIds);
      if (isDuplicate) {
        console.log("Latest lifelog is a duplicate. No new lifelogs to fetch.");
        return [];
      }
    }
    
    const result = await fetchDescendingStrategy(args, existingIds);
    if (!result.success) {
      console.log(result.message);
      return [];
    }
    return result.lifelogs;
  } else {
    const result = await fetchAscendingStrategy(args, existingIds);
    return result.lifelogs;
  }
}

/**
 * Synchronizes lifelogs from the Limitless API to the Convex database.
 *
 * This action implements a smart sync strategy that adapts based on existing data:
 * - First Sync: Fetches all lifelogs in ascending order (oldest first)
 * - Subsequent Syncs: Fetches newest lifelogs in descending order until a known lifelog is found
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
    const direction = isFirstSync ? "asc" : (CONFIG.experimentalDescendingStrategy ? "desc" : "asc");
    console.log(
      `Sync strategy: ${direction}`,
    );

    const startString = direction === "asc" ? new Date(metadata.endTime).toISOString() : undefined;
    // 3. Fetch lifelogs using the chosen strategy
    const fetchArgs: LifelogRequest = {
      start: startString,
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

// ================================================================================
// PUBLIC API
// ================================================================================

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
