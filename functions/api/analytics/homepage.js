import { HttpError } from "../../../server/razorpay/http.js";
import {
  assertHomepageOrigin,
  declinesHomepageMeasurement,
  homepageErrorResponse,
  incrementHomepageCount,
  readHomepageEvent,
} from "../../../server/analytics/homepage-counts.js";

export function createHomepageCountHandler(overrides = {}) {
  const dependencies = { assertHomepageOrigin, incrementHomepageCount, now: () => new Date(), ...overrides };
  return async function homepageCount(context) {
    try {
      if (context.request.method !== "POST") throw new HttpError(405, "POST required.");
      dependencies.assertHomepageOrigin(context.request);
      if (!declinesHomepageMeasurement(context.request)) {
        const event = await readHomepageEvent(context.request);
        await dependencies.incrementHomepageCount(context.env, event, dependencies.now());
      }
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return homepageErrorResponse(error);
    }
  };
}

export const onRequest = createHomepageCountHandler();
