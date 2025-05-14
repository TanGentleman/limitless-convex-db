/**
 * Converts a Date object to YYYY-MM-DD format string.
 * 
 * @param date - Date object to format
 * @returns string - Formatted date string
 */
export const formatDateToYYYYMMDD = (date: Date): string => {
  return date.toISOString().split('T')[0];
}

/**
 * Gets the next calendar day after the provided date.
 * 
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param daysToAdd - Number of days to add (default: 1)
 * @returns string - Next day in YYYY-MM-DD format
 */
export const getNextDay = (dateStr: string, daysToAdd: number = 1, validate: boolean = true): string | null => {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + daysToAdd);
  
  // Check if the calculated date is in the future
  const now = new Date();
  if (date > now) {
    return null;
  }
  
  return formatDateToYYYYMMDD(date);
}


/**
 * Formats markdown content for Slack display
 *
 * @param markdown - The raw markdown content to format
 * @param removeTitle - Whether to remove the first line (typically the title)
 * @returns Formatted markdown string optimized for Slack
 */
export const formatMarkdown = (
  markdown: string,
  removeTitle: boolean = false,
): string => {
  // Remove title if requested
  const content = removeTitle
    ? markdown.split("\n").slice(1).join("\n")
    : markdown;

  // Apply markdown transformations
  return (
    content
      // Convert headers to bold text
      .replace(/^#{1,3} (.*$)/gm, "*$1*")
      // Convert bullet points to Slack-friendly format
      .replace(/\n- /g, "\n• ")
  );
};

// Helper functions to make timestamps human readable
// Use os.env.TIMEZONE to get the timezone
// Wrapper function for date formatting
export const formatDate = (
  date: Date | number | string,
  timezone?: string,
): string => {
  const d = new Date(date);
  return d.toLocaleString("en-US", {
    timeZone: timezone || process.env.TIMEZONE || "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

// Generic operation creation helper
const createOperation = (
  operation: "sync" | "create" | "read" | "update" | "delete",
  table: "lifelogs" | "metadata" | "markdownEmbeddings",
  success: boolean,
  data: { message?: string; error?: string },
) => ({
  operation,
  table,
  success,
  data:
    !success && !data.error && data.message ? { error: data.message } : data,
});

// Simplified metadata operation creator
export const metadataOperation = (
  operation: "create" | "update" | "delete" | "sync",
  message: string,
  success: boolean = true,
) => {
  return createOperation(operation, "metadata", success, { message });
};

export const lifelogOperation = (
  operation: "create" | "read" | "update" | "delete",
  message: string,
  success: boolean = true,
) => {
  return createOperation(operation, "lifelogs", success, { message });
};

export const markdownEmbeddingOperation = (
  operation: "create" | "read" | "update" | "delete",
  message: string,
  success: boolean = true,
) => {
  return createOperation(operation, "markdownEmbeddings", success, {
    message,
  });
};

export const seedMetadata = {
  startTime: 0,
  endTime: 0,
  syncedUntil: 0,
  lifelogIds: [],
};
