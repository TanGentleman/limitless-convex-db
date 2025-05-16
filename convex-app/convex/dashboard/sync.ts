import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  LimitlessLifelog,
  convertToConvexFormat,
  LifelogRequest,
} from "../types";
import { formatDate, formatDateToYYYYMMDD, getNextDay, metadataOperation } from "../extras/utils";

// ================================================================================
// CONSTANTS
// ================================================================================

const MESSAGES = {
  DUPLICATE_FOUND: "Found existing lifelog ID",
  LATEST_IS_DUPLICATE: "Latest lifelog is a duplicate.",
  LATEST_IS_NEW: "Latest lifelog is new.",
  NO_LIFELOGS_FOUND: "No lifelogs found",
  REACHED_LIMIT: "Reached limit",
  REACHED_MAX_API_CALLS: "Reached maximum API calls",
  SYNC_COMPLETE: "Sync is complete",
  NO_NEXT_CURSOR: "No next cursor",
  FEWER_ITEMS: "Received fewer items than batch size",
};

// ================================================================================
// TYPES AND INTERFACES
// ================================================================================

/**
 * Error categories for API errors
 */
type ErrorCategory = 'auth' | 'timeout' | 'server' | 'client' | 'unknown' | 'needDupeCondition';

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
  /** Last date that was processed */
  lastProcessedDate?: string;
  /** Number of API calls made during the operation */
  apiCalls: number;
  /** Error category if there was an error */
  errorCategory?: ErrorCategory;
}

/**
 * Configuration constants for lifelog synchronization.
 */
const CONFIG = {
  /** Number of lifelogs to fetch per API request */
  defaultBatchSize: 20,
  /** Maximum number of lifelogs to fetch per sync */
  maximumLimit: 200,
  /** Maximum consecutive duplicate batches before stopping */
  maxDuplicateBatches: 3,
  /** Maximum API calls per sync operation */
  maxApiCalls: 7,
  /** Whether to use descending strategy by default for non-first syncs */
  experimentalDescendingStrategy: false,
  /** Whether to use date parameter instead of start for ascending strategy */
  experimentalAscDateIncrement: true,
  /** Whether to perform a preliminary check before full descending sync */
  runPreliminarySync: false,
  /** Use the new well-behaved hybrid sync algorithm */
  useWellBehavedSyncAlgorithm: true,
  /** Number of API calls to check for gaps on previous date */
  checkPreviousDateCalls: 2,
};

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
    includeMarkdown: args.includeMarkdown !== false,
    includeHeadings: args.includeHeadings !== false,
    direction: args.direction,
    ...(cursor && { cursor }),
    ...(args.timezone && { timezone: args.timezone }),
  };
  
  // Handle date parameter
  if (args.date) {
    params.date = args.date;
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
 * @returns Object with HTTP status code and error category
 */
async function handleApiError(response: Response): Promise<{status: number, category: ErrorCategory}> {
  let category: ErrorCategory = 'unknown';
  
  if (response.status === 504) {
    console.error("HTTP error! Timeout. Please try again later.");
    category = 'timeout';
  } else if (response.status === 500) {
    console.error("HTTP error! Limitless server. Check params!");
    category = 'server';
  } else if (response.status === 401 || response.status === 403) {
    console.error("HTTP error! Authentication issue.");
    category = 'auth';
  } else if (response.status >= 400 && response.status < 500) {
    console.error(`HTTP error! Client error: ${response.status}`);
    category = 'client';
  } else {
    console.error(
      `HTTP error! Status: ${response.status}, Body: ${await response.text()}`,
    );
  }
  
  return { status: response.status, category };
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
        `${MESSAGES.DUPLICATE_FOUND} ${log.id} (endTime: ${log.endTime ? formatDate(log.endTime) : "N/A"}). Stopping fetch.`,
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

  // Stop if the API returned fewer results than requested
  if (batchSize < requestedBatchSize) {
    console.log(
      `${MESSAGES.FEWER_ITEMS} (${batchSize}/${requestedBatchSize}).`,
    );
    return { continue: false, dateIsDone: true };
  }
  // If there's no next cursor, then we're done.
  if (!nextCursor) {
    console.log(`${MESSAGES.NO_NEXT_CURSOR}. Ending fetch.`);
    return { continue: false };
  }
  
  // Check if we've reached the requested limit
  if (limit !== undefined && totalFetched >= limit) {
    console.log(`${MESSAGES.REACHED_LIMIT} of ${limit} lifelogs. Stopping fetch.`);
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
 * @returns Promise<FetchResult> - Result with duplicate check information
 */
async function checkLatestLifelogDuplicate(
  existingIds: Set<string>,
  date?: string,
): Promise<FetchResult> {
  const args: LifelogRequest = {
    date: date,
    direction: "desc",
    includeMarkdown: false,
    includeHeadings: false,
  };
  const batchSize = 1;
  const response = await makeApiRequest(args, undefined, batchSize);
  const apiCalls = 1;
  
  if (!response.ok) {
    const error = await handleApiError(response);
    return {
      lifelogs: [],
      success: false,
      message: "Failed to check latest lifelog duplicate.",
      apiCalls,
      errorCategory: error.category
    };
  }

  const data = await response.json();
  const lifelogs: LimitlessLifelog[] = data.data?.lifelogs || [];
  
  if (lifelogs.length === 0) {
    console.log(`${MESSAGES.NO_LIFELOGS_FOUND} in latest check.`);
    return {
      lifelogs: [],
      success: true,
      message: `${MESSAGES.NO_LIFELOGS_FOUND} in latest check.`,
      apiCalls
    };
  }

  const latestLifelog = lifelogs[0];
  const isDuplicate = existingIds.has(latestLifelog.id);
  
  console.log(
    `Latest lifelog check: ID ${latestLifelog.id} (endTime: ${latestLifelog.endTime ? formatDate(latestLifelog.endTime) : "N/A"}) is ${isDuplicate ? "a duplicate" : "new"}.`
  );
  
  return {
    lifelogs: isDuplicate ? [] : [latestLifelog],
    success: true,
    message: isDuplicate ? MESSAGES.LATEST_IS_DUPLICATE : MESSAGES.LATEST_IS_NEW,
    apiCalls,
  };
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
      const error = await handleApiError(response);
      return {
        lifelogs: [],
        success: false,
        message: "Failed to fetch descending lifelogs.",
        apiCalls,
        errorCategory: error.category
      };
    }

    const data = await response.json();
    const lifelogsInBatch: LimitlessLifelog[] = data.data?.lifelogs || [];
    const meta: ApiResponseMeta = data.meta || {};

    if (lifelogsInBatch.length === 0) {
      console.log(`${MESSAGES.NO_LIFELOGS_FOUND} in this desc batch. Ending fetch.`);
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
        message: `Unsuccessful sync. Do not try this strategy with ${CONFIG.maximumLimit}+ pending lifelogs.`,
        apiCalls
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
        ? `${MESSAGES.REACHED_LIMIT} of ${CONFIG.maximumLimit} lifelogs without finding duplicate.`
        : `Incomplete sync: No duplicate found. Sync not saved.`,
    apiCalls
  };
}

// ================================================================================
// ASCENDING STRATEGY IMPLEMENTATION
// ================================================================================

/**
 * Ascending fetch strategy - fetches oldest lifelogs first.
 * Used for initial syncs or fetching historical data.
 * 
 * @param args - Request parameters
 * @param existingIds - Set of existing lifelog IDs
 * @returns Promise<FetchResult> - The fetch result with lifelogs and status
 */
async function fetchAscendingStrategy(
  args: LifelogRequest,
  existingIds: Set<string>
): Promise<FetchResult> {
  const completedLifelogs: LimitlessLifelog[] = [];
  const allNewLifelogs: LimitlessLifelog[] = [];
  
  let cursor = args.cursor;
  let duplicateBatches = 0;
  let apiCalls = 0;
  let lastCompletedDate: string | undefined = undefined;
  
  while (apiCalls < CONFIG.maxApiCalls) {
    const batchSize = CONFIG.defaultBatchSize;
    const response = await makeApiRequest(args, cursor, batchSize);
    apiCalls++;
    
    if (!response.ok) {
      const error = await handleApiError(response);
      return {
        lifelogs: completedLifelogs,
        success: false,
        message: "Failed to fetch ascending lifelogs.",
        lastProcessedDate: lastCompletedDate,
        apiCalls,
        errorCategory: error.category
      };
    }

    const data = await response.json();
    const lifelogsInBatch: LimitlessLifelog[] = data.data?.lifelogs || [];
    const meta: ApiResponseMeta = data.meta || {};

    // Handle empty batch case
    if (lifelogsInBatch.length === 0) {
      console.log(`${MESSAGES.NO_LIFELOGS_FOUND} in this asc batch.`);
      lastCompletedDate = args.date;
      
      // If using date-based incremental fetching, move to next day
      if (CONFIG.experimentalAscDateIncrement && args.date) {
        const nextDay = getNextDay(args.date);
        if (nextDay === null) {
          console.log(`Date ${args.date} is the last day of data. No more data to fetch.`);
          break;
        }
        args.date = nextDay;
        args.cursor = undefined;
        continue;
      }
      break;
    }

    // Filter out duplicates
    const newLogs = lifelogsInBatch.filter(log => !existingIds.has(log.id));
    
    // Track consecutive duplicate batches
    if (newLogs.length === 0) {
      duplicateBatches++;
      if (duplicateBatches > CONFIG.maxDuplicateBatches) {
        console.log(`Found ${duplicateBatches} duplicate batches. Stopping fetch.`);
        break;
      }
    }
    
    allNewLifelogs.push(...newLogs);
    
    // Handle pagination
    const paginationResult = handlePagination(
      meta,
      lifelogsInBatch.length, 
      batchSize, 
      allNewLifelogs.length, 
      args.limit
    );

    // Handle date increment when a day is complete
    if (CONFIG.experimentalAscDateIncrement && args.date && !paginationResult.nextCursor) {
      lastCompletedDate = args.date;
      const nextDate = getNextDay(args.date);
      
      if (nextDate === null) {
        console.log(`Date following ${args.date} is the last day of data. No more data to fetch.`);
        break;
      }
      
      // Reset for next day
      args.date = nextDate;
      args.cursor = undefined;
      completedLifelogs.push(...allNewLifelogs);
      allNewLifelogs.length = 0;
      continue;
    }

    // Stop if no more pages
    if (!paginationResult.continue) {
      break;
    }

    // Check if we've reached the maximum limit
    if (completedLifelogs.length >= CONFIG.maximumLimit) {
      console.log(`${MESSAGES.REACHED_LIMIT} of ${CONFIG.maximumLimit} lifelogs. Stopping fetch.`);
      break;
    }
    
    cursor = paginationResult.nextCursor;
  }

  // Add any remaining logs to the result
  if (allNewLifelogs.length > 0) {
    completedLifelogs.push(...allNewLifelogs);
  }

  return {
    lifelogs: completedLifelogs,
    success: true,
    message: `Fetch complete (ascending). Retrieved ${completedLifelogs.length} new lifelogs.`,
    lastProcessedDate: lastCompletedDate,
    apiCalls
  };
}

// ================================================================================
// WELL-BEHAVED SYNC ALGORITHM IMPLEMENTATION
// ================================================================================

/**
 * Checks if there are any missing lifelogs on a specific date.
 * 
 * @param date - Date string in YYYY-MM-DD format to check
 * @param existingIds - Set of existing lifelog IDs
 * @returns Promise<FetchResult> - Result with missing lifelogs information
 */
async function checkMissingLogsForDate(
  date: string,
  existingIds: Set<string>
): Promise<FetchResult> {
  console.log(`Checking for missing lifelogs on ${date}...`);
  if (!date) {
    throw new Error("Date is required for checkMissingLogsForDate.");
  }
  const args: LifelogRequest = {
    date: date,
    direction: "desc",
    includeMarkdown: true,
    includeHeadings: true,
  };
  
  const missingLogs: LimitlessLifelog[] = [];
  let apiCalls = 0;
  let cursor: string | undefined = undefined;
  
  let foundDuplicate = false;
  while (apiCalls < CONFIG.checkPreviousDateCalls && !foundDuplicate) {
    const response = await makeApiRequest(args, cursor, CONFIG.defaultBatchSize);
    apiCalls++;
    
    if (!response.ok) {
      const error = await handleApiError(response);
      return {
        lifelogs: missingLogs,
        success: missingLogs.length > 0,
        message: `Failed to check date ${date} for missing logs after ${apiCalls} API calls.`,
        apiCalls,
        errorCategory: error.category
      };
    }
    
    const data = await response.json();
    const lifelogs: LimitlessLifelog[] = data.data?.lifelogs || [];
    
    if (lifelogs.length === 0) {
      foundDuplicate = true;
      // success condition: Move on to next day if possible
      break;
    }
    
    // Filter for new logs
    const newLogs = lifelogs.filter(log => !existingIds.has(log.id));
    missingLogs.push(...newLogs);
    
    // If we find duplicates, we've likely seen all data for this date
    if (newLogs.length !== lifelogs.length) {
      foundDuplicate = true;
      break;
    }

    const meta: ApiResponseMeta = data.meta || {};
    const nextCursor = meta.lifelogs?.nextCursor;
    
    if (!nextCursor) {
      break;
    }
    
    cursor = nextCursor;
  }
  
  
  console.log(`Found ${missingLogs.length} missing lifelogs for date ${date}.`);
  if (!foundDuplicate) {
    console.log(`Descending strategy did not find duplicates for date ${date}.`);
    return {
      lifelogs: [],
      success: false,
      message: `Found ${missingLogs.length} missing lifelogs but no duplicate for date ${date} after ${apiCalls} API calls.`,
      apiCalls,
      errorCategory: 'needDupeCondition'
    };
  }
  return {
    lifelogs: missingLogs.reverse(),
    success: true,
    message: `Found ${missingLogs.length} missing lifelogs for date ${date} after ${apiCalls} API calls. Duplicate was found.`,
    apiCalls,
    lastProcessedDate: date
  };
}

/**
 * Implements the Well-Behaved Sync Algorithm that efficiently syncs lifelogs
 * by combining date-based pagination with smart duplicate detection.
 * 
 * Algorithm flow:
 * 1. Check if latest lifelog on the last sync date is already in the database
 * 2. If it's a duplicate, increment to the next day
 * 3. Use ascending strategy to fetch all lifelogs from that point forward
 *
 * @param lastSyncDate - Date string of the last successful sync (YYYY-MM-DD)
 * @param existingIds - Set of existing lifelog IDs
 * @returns Promise<FetchResult> - The fetch result with lifelogs and status
 */
async function wellBehavedSyncAlgorithm(
  lastSyncDate: string,
  existingIds: Set<string>
): Promise<FetchResult> {
  if (!lastSyncDate) {
    throw new Error("Last sync date is required for well-behaved sync.");
  }
  
  let dateToSync = lastSyncDate;
  let apiCalls = 0;
  let lastCompletedDate: string | undefined = undefined;
  
  // Run optional preliminary check without date filter
  if (CONFIG.runPreliminarySync) {
    const latestCheckResult = await checkLatestLifelogDuplicate(existingIds);
    apiCalls += latestCheckResult.apiCalls;
    
    if (!latestCheckResult.success) {
      return {
        lifelogs: [],
        success: false,
        message: `Failed to check if DB is up-to-date: ${latestCheckResult.message}`,
        apiCalls,
        errorCategory: latestCheckResult.errorCategory
      };
    }
    
    if (latestCheckResult.message === MESSAGES.LATEST_IS_DUPLICATE) {
      return {
        lifelogs: [],
        success: true,
        message: "Database is already up-to-date.",
        apiCalls
      };
    }
  }
  
  // Check if the DB is up-to-date for the specific date
  const dateCheckResult = await checkLatestLifelogDuplicate(existingIds, dateToSync);
  apiCalls += dateCheckResult.apiCalls;
  
  if (!dateCheckResult.success) {
    return {
      lifelogs: [],
      success: false,
      message: `Failed to check if DB is up-to-date for date ${dateToSync}: ${dateCheckResult.message}`,
      apiCalls,
      errorCategory: dateCheckResult.errorCategory
    };
  }
  
  // If current date is up-to-date, move to next day
  if (dateCheckResult.message === MESSAGES.LATEST_IS_DUPLICATE) {
    console.log(`Database is already up-to-date for date ${dateToSync}.`);
    lastCompletedDate = dateToSync;
    
    const nextDay = getNextDay(dateToSync);
    if (nextDay === null) {
      return {
        lifelogs: [],
        success: true,
        message: "Database is already up-to-date through today.",
        apiCalls
      };
    } 
    dateToSync = nextDay;
  }
  
  // Use ascending strategy to fetch all lifelogs from the start date forward
  const ascendingResult = await fetchAscendingStrategy(
    {
      date: dateToSync,
      direction: "asc",
      includeMarkdown: true,
      includeHeadings: true,
    },
    existingIds
  );
  
  apiCalls += ascendingResult.apiCalls;
  
  return {
    lifelogs: ascendingResult.lifelogs,
    success: ascendingResult.success,
    message: ascendingResult.message,
    apiCalls,
    lastProcessedDate: ascendingResult.lastProcessedDate || lastCompletedDate,
    errorCategory: ascendingResult.errorCategory
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
 * - If using well-behaved algorithm, combines both approaches with date-based sync.
 *
 * @param args - Request parameters for the API
 * @param existingIds - Set of existing lifelog IDs to detect duplicates
 * @returns Promise<FetchResult> - Object with lifelogs and metadata about the fetch operation
 */
async function fetchLifelogs(
  args: LifelogRequest,
  existingIds: Set<string>
): Promise<FetchResult> {
  try {
    validateFetchParams(args);
    
    if (args.direction === undefined) {
      return {
        lifelogs: [],
        success: false,
        message: "Fetch direction ('asc' or 'desc') must be specified.",
        apiCalls: 0
      };
    }
    
    // If using the well-behaved algorithm and this is not a first sync
    if (CONFIG.useWellBehavedSyncAlgorithm && existingIds.size > 0) {
      // assert that args.date is defined
      if (args.date === undefined)  {
        throw new Error("Date param must be included for well-behaved sync.");
      }
      // Extract the date from the last synced timestamp
      const lastSyncDate = args.date;
      
      console.log(`Using well-behaved sync algorithm with last sync date: ${lastSyncDate}`);
      return await wellBehavedSyncAlgorithm(lastSyncDate, existingIds);
    }
    
    // Otherwise use the original strategies
    if (args.direction === "desc") {
      // First check if the latest lifelog is a duplicate
      if (CONFIG.runPreliminarySync) {
        const latestCheckResult = await checkLatestLifelogDuplicate(existingIds);
        if (!latestCheckResult.success) {
          return {
            lifelogs: [],
            success: false,
            message: latestCheckResult.message,
            apiCalls: latestCheckResult.apiCalls,
            errorCategory: latestCheckResult.errorCategory
          };
        }
        
        const isDuplicate = latestCheckResult.message === MESSAGES.LATEST_IS_DUPLICATE;
        if (isDuplicate) {
          console.log("Latest lifelog is a duplicate. No new lifelogs to fetch.");
          return {
            lifelogs: [],
            success: true,
            message: "Latest lifelog is a duplicate. No new lifelogs to fetch.",
            apiCalls: latestCheckResult.apiCalls
          };
        }
      }
      
      return await fetchDescendingStrategy(args, existingIds);
    } else {
      return await fetchAscendingStrategy(args, existingIds);
    }
  } catch (error) {
    console.error("Error in fetchLifelogs:", error);
    return {
      lifelogs: [],
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
      apiCalls: 0
    };
  }
}

/**
 * Synchronizes lifelogs from the Limitless API to the Convex database.
 *
 * This action implements a smart sync strategy that adapts based on existing data:
 * - First Sync: Fetches all lifelogs in ascending order (oldest first)
 * - Subsequent Syncs: Uses well-behaved algorithm to efficiently catch up
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
    if (isFirstSync) {
      // Handle separately
      const args: LifelogRequest = {
        direction: "asc",
        includeMarkdown: true,
        includeHeadings: true,
      };
      const cursor = undefined;
      const batchSize = 1;
      const response = await makeApiRequest(args, cursor, batchSize);
      if (!response.ok) {
        const error = await handleApiError(response);
        throw new Error(`Failed first sync: ${error.status} ${error.category}`);
      }
      // Process the response
      const data = await response.json();
      const lifelogs: LimitlessLifelog[] = data.data?.lifelogs || [];
  
      if (lifelogs.length === 0) {
        console.log(`${MESSAGES.NO_LIFELOGS_FOUND} in first sync.`);
        throw new Error("No lifelogs found in first sync.");
      }
      const convexLifelogs = convertToConvexFormat(lifelogs);
      const newLifelogIds = await ctx.runMutation(internal.lifelogs.createDocs, {
        lifelogs: convexLifelogs,
      });
      const firstLifelog = convexLifelogs[0];
      const metadata = {
        startTime: firstLifelog.startTime,
        endTime: firstLifelog.endTime,
        lifelogIds: newLifelogIds,
        syncedUntil: firstLifelog.endTime
      };
      await ctx.runMutation(internal.metadata.createDocs, {
        metadataDocs: [metadata],
      });
      // operation
      const operation = metadataOperation(
        "sync",
        `First sync completed successfully. Added ${lifelogs.length} lifelogs.`,
        true,
      );
      await ctx.runMutation(internal.operations.createDocs, {
        operations: [operation],
      });
      return true;
    }
    // If this is not the first sync and we have end time
    const lastSyncDateStr = formatDateToYYYYMMDD(new Date(metadata.syncedUntil));
    const direction = CONFIG.experimentalDescendingStrategy ? "desc" : "asc";
    console.log(
      `Sync strategy: ${direction}, using well-behaved algorithm: ${CONFIG.useWellBehavedSyncAlgorithm}`,
    );
    
    // 3. Fetch lifelogs using the chosen strategy
    const fetchArgs: LifelogRequest = {
      direction: direction,
      includeMarkdown: true,
      includeHeadings: true,
    };
    
    // Only add date parameter if using experimental features
    if (CONFIG.experimentalAscDateIncrement || CONFIG.useWellBehavedSyncAlgorithm) {
      fetchArgs.date = lastSyncDateStr;
    }
    
    const fetchResult = await fetchLifelogs(fetchArgs, existingIdsSet);
    const fetchedLifelogs = fetchResult.lifelogs;

    // 4. Process fetched lifelogs
    if (fetchedLifelogs.length === 0) {
      console.log("No new lifelogs found from API.");
      const operation = metadataOperation(
        "sync",
        `No new lifelogs found. ${existingIdsSet.size} lifelogs up to date. API calls: ${fetchResult.apiCalls}`,
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
    const newEndTime = convexLifelogs[convexLifelogs.length - 1].endTime;

    const updatedEndTime = Math.max(metadata.endTime, newEndTime);
    if (metadata.endTime > newEndTime) {
      console.error(`Existing metadata.endTime (${metadata.endTime}) is later than new batch endTime (${newEndTime})`);
    }
    // syncedUntil should reflect the timestamp of the latest known record
    const processedDate = fetchResult.lastProcessedDate 
      ? new Date(fetchResult.lastProcessedDate).getTime() 
      : 0;
    const updatedSyncedUntil = Math.max(processedDate, updatedEndTime);
    const updatedLifelogIds = metadata.lifelogIds.concat(newLifelogIds);

    const operation = metadataOperation(
      "sync",
      `Added ${newLifelogs.length} new lifelogs. Total: ${updatedLifelogIds.length}. API calls: ${fetchResult.apiCalls}`,
      true,
    );
    await ctx.runMutation(internal.metadata.createDocs, {
      metadataDocs: [
        {
          startTime: metadata.startTime,
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
