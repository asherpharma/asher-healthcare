import { requireAdminStaff } from "../../../server/razorpay/firebase.js";
import { HttpError, json } from "../../../server/razorpay/http.js";
import {
  assertHomepageOrigin,
  getHomepageCounts,
  homepageErrorResponse,
  homepageReportDays,
} from "../../../server/analytics/homepage-counts.js";

export function createHomepageReportHandler(overrides = {}) {
  const dependencies = { assertHomepageOrigin, getHomepageCounts, requireAdminStaff, now: () => new Date(), ...overrides };
  return async function homepageReport(context) {
    try {
      if (context.request.method !== "GET") throw new HttpError(405, "GET required.");
      dependencies.assertHomepageOrigin(context.request, { adminRead: true });
      const administrator = await dependencies.requireAdminStaff(context.request, context.env);
      if (administrator?.role !== "admin") throw new HttpError(403, "Administrator required.");
      const days = homepageReportDays(context.request);
      return json(await dependencies.getHomepageCounts(context.env, days, dependencies.now()));
    } catch (error) {
      return homepageErrorResponse(error);
    }
  };
}

export const onRequest = createHomepageReportHandler();
