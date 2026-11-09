import moment from 'moment-timezone';

export const isValidTimezone = (timezone: string) =>
  moment.tz.zone(timezone) !== null;

/**
 * Converts a `date` parameter to the day's bounds in `timezone`.
 * Accepts YYYY-MM-DD (the Limitless format) and the older MM-DD-YYYY.
 * @returns { start, end } in ms since epoch (end exclusive), or undefined if invalid
 */
export const dateParamToTimestamp = (
  dateString: string | undefined,
  timezone: string | undefined,
): { start: number; end: number } | undefined => {
  if (dateString === undefined) return undefined;
  const date = moment.tz(
    dateString,
    ['YYYY-MM-DD', 'MM-DD-YYYY'],
    true,
    timezone || 'UTC',
  );
  if (!date.isValid()) return undefined;
  return {
    start: date.valueOf(),
    end: date.clone().add(1, 'day').valueOf(),
  };
};

const TIME_FORMATS = [
  'YYYY-MM-DD',
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DD HH:mm:ss.SSS',
  'YYYY-MM-DDTHH:mm',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss.SSS',
];

/**
 * Converts a `start`/`end` parameter (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS) to ms since
 * epoch, read as local time in `timezone`. Like the Limitless API, a trailing `Z` or
 * UTC offset is ignored. Throws on anything else.
 */
export const timeParamToTimestamp = (value: string, timezone: string) => {
  const local = value.trim().replace(/(Z|[+-]\d{2}:?\d{2})$/, '');
  const time = moment.tz(local, TIME_FORMATS, true, timezone);
  if (!time.isValid()) {
    throw new Error(
      `Invalid datetime: ${value} (expected YYYY-MM-DD or YYYY-MM-DD HH:mm:SS)`,
    );
  }
  return time.valueOf();
};
