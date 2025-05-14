# Sync Strategy Documentation

Doing sync really well is hard. The user wants that button to just...work. This doc is born out of my pursuit to do just that. Users have hundreds or thousands of lifelogs backed up to the first-party cloud server, and we don't want to abuse the API that has been politely offered to developers. Here are the limitations and solutions I've put some thought into.

## Available Resources

- Official Web Docs: https://www.limitless.ai/developers/docs/api
- Official API spec: https://github.com/limitless-ai-inc/limitless-api-examples/blob/main/openapi.yml
- Reference Python and TypeScript implementations are provided too, check upstream if that would benefit you.

## Challenges

- The exposed `startTime` parameter is finicky. The published _client.ts/py codefiles avoid this param altogether, and I found it unreliable.
- The date parameter and its relation to the optional timezone param seemed mysterious.
- To populate and maintain a database reliably, both ascending and descending sort have incompatibility with a naive implementation.
- We want a system that can reliably undo a "botched sync" or destructive mutations to our DB.

## Sync Strategies

Let's assume a constraint of 5 API calls in a minute. We also always want our database to be correctly sorted and up to date, ascending.

### Regular Scheduled Syncs
- This sync, by default, uses a descending sort with no timestamp parameters, and with a max of 5 batches of 10 lifelogs, this can be scheduled at daily-or-so intervals and work out close to perfectly.
- **Concern**: Many lifelogs out-of-sync can be problematic if we are unable to make sufficient requests until we are caught up. We always want our DB to be favorably up to date. Higher batch sizes or rate limits may sort this out.

### Catch-up Syncs
- This sync uses an ascending search, and is the default when seeding your database until it is caught up.
- For subsequent syncs (or after being rate limited) we use custom Convex tables to organize metadata in the DB to simply "continue where we left off."
- **Concern**: When restricted to the date parameter, it can be a tougher nut to crack.

## Practical Example

A practical example where most solutions get stuck:

1. I am excited to be a custodian of my own data after getting a pendant and making my developer API key.
2. I have started a sync, and have backed up the first 47 lifelogs until April 3.
3. I went on a break from April 3-April 15, then started using the pendant more regularly.
4. It's now May, and want to resume so I can use the fully compatible endpoint to grab my lifelogs without rate limits.

### Resuming Sync Challenges

- If the system uses the descending sync, it will have to fetch all of the lifelogs until April 3 in one go to stay up to date. This may not be feasible! (Though a partial sync can be helpful to the backend and prevent abuse of future API calls.)
- If I use the ascending sync with the date parameter, the best info I have is that my last lifelog was on April 3. Should I keep making API requests for April 4? 5? 6? What if I missed one from April 3?

## Proposed Solution

Here comes the benefit of full type safety and scheduled actions that don't cause DB conflicts. To be polite, we should:

- Spend 1 API call to check if our DB is up-to-date (descending).
- Spend 1 API call to check if we are missing any lifelogs on a particular `date` (descending).
- Effectively use our set of existing lifelog IDs with the params permitted by the API.

## Well-Behaved Sync Algorithm
1. Extract the endTime from the most recent lifelog in our database and convert it to a date string.
2. Make an API call with `direction: "desc"` and the appropriate `date` (e.g., "2023-04-03").
3. Make an API call with `direction: "asc"` and `date` set to the next calendar day.
4. Continue until encountering an error, then store information about the sync failure.
5. To resume, start from the last successful sync point (Step 1) or use the failure timestamp to determine the appropriate `date`. This reduces unnecessary API calls and prevents error loops.