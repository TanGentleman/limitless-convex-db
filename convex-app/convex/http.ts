import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { formatDate } from "./extras/utils";
import { LifelogRequest } from "./sync";
import { convertToLimitlessFormat } from "./types";

const http = httpRouter();

// Define a route for syncing Limitless data
http.route({
  path: "/sync",
  method: "GET",
  handler: httpAction(async (ctx) => {
    try {
      const isNewLifelogs = await ctx.runAction(internal.sync.syncLimitless);
      // Return appropriate response
      return new Response(
        JSON.stringify({
          success: true,
          timestamp: formatDate(new Date()),
          newEntriesAdded: isNewLifelogs,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      console.error("Error in sync HTTP action:", "See Dev logs.");
      return new Response(
        JSON.stringify({
          success: false,
          error: "An unexpected error occurred during sync",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }
  }),
});
// Define a route for reading lifelogs with API key authentication
http.route({
  path: "/v1/lifelogs",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      // Verify API key from Authorization header
      const authHeader = request.headers.get("Authorization");
      const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      
      if (!apiKey || apiKey !== process.env.LIMITLESS_API_KEY) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Invalid or missing API key" }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // Parse query parameters from URL
      const url = new URL(request.url);
      const params = url.searchParams;
      
      // Build LifelogRequest from query parameters
      const requestOptions: LifelogRequest = {
        timezone: params.get("timezone") || undefined,
        date: params.get("date") || undefined,
        start: params.get("start") || undefined,
        end: params.get("end") || undefined,
        cursor: params.get("cursor") || undefined,
        direction: (params.get("direction") as "asc" | "desc") || "desc",
        includeMarkdown: params.has("includeMarkdown") ? params.get("includeMarkdown") === "true" : true,
        includeHeadings: params.has("includeHeadings") ? params.get("includeHeadings") === "true" : true,
        limit: params.has("limit") ? parseInt(params.get("limit") as string, 10) : undefined,
      };
      
      // Convert date/time parameters to numeric timestamps if necessary
      let startTime: number | undefined = undefined;
      let endTime: number | undefined = undefined;
      
      if (requestOptions.start) {
        startTime = new Date(requestOptions.start).getTime();
      }
      
      if (requestOptions.end) {
        endTime = new Date(requestOptions.end).getTime();
      }
      
      // Read lifelogs using internal query
      const convexLifelogs = await ctx.runQuery(internal.lifelogs.readDocs, {
        startTime,
        endTime,
        direction: requestOptions.direction,
        limit: requestOptions.limit,
      });

      // Convert lifelogs to Limitless format
      const limitlessLifelogs = convertToLimitlessFormat(convexLifelogs);

      // filter markdown and headings if requested
      if (!requestOptions.includeMarkdown) {
        limitlessLifelogs.forEach(lifelog => {
          lifelog.markdown = null;
        });
      }

      if (!requestOptions.includeHeadings) {
        limitlessLifelogs.forEach(lifelog => {
          lifelog.contents = lifelog.contents.filter(content => content.type !== "heading1" && content.type !== "heading2" && content.type !== "heading3");
        });
      }
      
      // Format the response according to OpenAPI schema
      return new Response(
        JSON.stringify({
          data: {
            lifelogs: limitlessLifelogs
          },
          meta: {
            lifelogs: {
              nextCursor: null, // Add actual cursor implementation if needed
              count: limitlessLifelogs.length
            }
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        }
      );
    } catch (error) {
      console.error("Error in lifelogs HTTP action:", "See Dev logs.");
      return new Response(
        JSON.stringify({
          error: "An unexpected error occurred during lifelogs retrieval",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  }),
});

// Add OPTIONS handler for CORS support for lifelogs
http.route({
  path: "/v1/lifelogs",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }),
});

// Add OPTIONS handler for CORS support
http.route({
  path: "/sync",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }),
});

export default http; 