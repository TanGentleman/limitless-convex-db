// Helper functions to make timestamps human readable
// Use os.env.TIMEZONE to get the timezone
// Wrapper function for date formatting
export const formatDate = (date: Date | number | string, timezone?: string): string => {
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    timeZone: timezone || process.env.TIMEZONE || 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

// Generic operation creation helper
const createOperation = (
  operation:"sync" | "create" | "read" | "update" | "delete",
  table: "lifelogs" | "metadata" | "markdownEmbeddings",
  success: boolean,
  data: { message?: string; error?: string }
) => ({
  operation,
  table,
  success,
  data: !success && !data.error && data.message ? { error: data.message } : data
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
  success: boolean = true
) => {
  return createOperation(operation, "lifelogs", success, { message });
};

export const markdownEmbeddingOperation = (
  operation: "create" | "read" | "update" | "delete",
  message: string,
  success: boolean = true
) => {
  return createOperation(operation, "markdownEmbeddings", success, { message });
};

export const seedMetadata = {
  startTime: 0,
  endTime: 0,
  syncedUntil: 0,
  lifelogIds: [],
};
