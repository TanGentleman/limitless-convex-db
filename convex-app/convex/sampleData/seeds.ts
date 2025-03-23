export const sampleLifelogs = [
    // Empty lifelog (should not be inserted into the database)
  {
    contents: [],
    embeddingId: null,
    endTime: 0,
    lifelogId: "",
    markdown: "",
    startTime: 0,
    title: "",
  },
  {
    contents: [],
    embeddingId: null,
    endTime: 1625097600000, // June 30, 2021, 8:00 PM
    lifelogId: "sample-lifelog-1",
    markdown: "# Sample Lifelog Entry\n\nThis is a sample lifelog entry with some markdown content.\n\n- Item 1\n- Item 2\n- Item 3",
    startTime: 1625076000000, // June 30, 2021, 2:00 PM
    title: "Sample Lifelog Entry",
  },
];

export const seedMetadata = {
  startTime: 0,
  endTime: 0,
  syncedUntil: 0,
  lifelogIds: [],
};

export const sampleLifelogRequest = {
  timezone: "America/Los_Angeles",
  start: "2021-06-30 00:00:00",
  end: "2021-06-30 23:59:59",
  include_markdown: true,
  include_headings: true,
  limit: 50,
  cursor: undefined
};
