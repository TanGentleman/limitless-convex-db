import moment from 'moment-timezone';

/**
 * Converts a date string in MM-DD-YYYY format to a timestamp
 * @param dateString Date string in MM-DD-YYYY format
 * @param timezone Timezone string (e.g. 'America/Los_Angeles')
 * @returns Timestamp in milliseconds since epoch, or undefined if invalid
 */
export const dateParamToTimestamp = (
  dateString: string | undefined,
  timezone: string | undefined,
) => {
  if (dateString === undefined) return undefined;
  if (dateString.length !== 10) {
    throw new Error('Invalid date format. Expected format: MM-DD-YYYY');
  }

  // Parse the date string (MM-DD-YYYY)
  const [month, day, year] = dateString.split('-');

  // Use moment-timezone with explicit format to avoid deprecation warning
  const date = moment.tz(
    `${year}-${month}-${day}`,
    'YYYY-MM-DD',
    timezone || 'UTC',
  );

  // Return the timestamp or undefined if invalid
  return date.isValid() ? date.valueOf() : undefined;
};