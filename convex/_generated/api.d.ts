/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as dashboard_previews from "../dashboard/previews.js";
import type * as dashboard_sync from "../dashboard/sync.js";
import type * as dateUtils from "../dateUtils.js";
import type * as extras_hooks from "../extras/hooks.js";
import type * as extras_patches from "../extras/patches.js";
import type * as extras_schedules from "../extras/schedules.js";
import type * as extras_tests from "../extras/tests.js";
import type * as extras_utils from "../extras/utils.js";
import type * as http from "../http.js";
import type * as lifelogs from "../lifelogs.js";
import type * as markdownEmbeddings from "../markdownEmbeddings.js";
import type * as metadata from "../metadata.js";
import type * as operations from "../operations.js";
import type * as types from "../types.js";
import type * as updates from "../updates.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "dashboard/previews": typeof dashboard_previews;
  "dashboard/sync": typeof dashboard_sync;
  dateUtils: typeof dateUtils;
  "extras/hooks": typeof extras_hooks;
  "extras/patches": typeof extras_patches;
  "extras/schedules": typeof extras_schedules;
  "extras/tests": typeof extras_tests;
  "extras/utils": typeof extras_utils;
  http: typeof http;
  lifelogs: typeof lifelogs;
  markdownEmbeddings: typeof markdownEmbeddings;
  metadata: typeof metadata;
  operations: typeof operations;
  types: typeof types;
  updates: typeof updates;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
