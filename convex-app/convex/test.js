const dateParamToTimestamp = (dateString, timezone) => {
    if (dateString === undefined) return undefined;
    if (dateString.length !== 10) {
        throw new Error("Invalid date format. Expected format: MM-DD-YYYY");
    }
    // convert dateString like 11-12-2024 using timezone
    const date = new Date(dateString);
    const options = { timeZone: timezone ?? 'UTC'};
    const zonedDate = new Date(date.toLocaleString('en-US', options));
    return isNaN(zonedDate.getTime()) ? undefined : zonedDate.getTime();
  };

  console.log("LA Time:", new Date(dateParamToTimestamp("05-17-2025", "America/Los_Angeles")).toLocaleString());
  console.log("UTC Time:", new Date(dateParamToTimestamp("05-17-2025")).toLocaleString());
  console.log("NY Time:", new Date(dateParamToTimestamp("05-17-2025", "America/New_York")).toLocaleString());

  console.log("Today in LA:", dateParamToTimestamp("05-17-2025", "America/Los_Angeles"));
  console.log("Today in LA:", new Date(dateParamToTimestamp("05-17-2025", "America/Los_Angeles")).toLocaleString());


  console.log("Today default:", dateParamToTimestamp("05-17-2025"));
  console.log("Today default:", new Date(dateParamToTimestamp("05-17-2025")).toLocaleString());
