import { searchPatientsForStaff } from "../../../../server/patients/search.js";
import { requireActiveStaff } from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../../server/razorpay/http.js";

const defaultDependencies = {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
  requireActiveStaff,
  searchPatientsForStaff,
};

export function createPatientSearchHandlers(dependencies = defaultDependencies) {
  return {
    async post(context) {
      try {
        dependencies.assertSameOrigin(context.request);
        const staff = await dependencies.requireActiveStaff(context.request, context.env);
        const body = await dependencies.readJson(context.request, 4_000);
        const result = await dependencies.searchPatientsForStaff(context.env, staff, {
          search: body?.search,
          cursor: body?.cursor,
          pageSize: body?.pageSize,
        });
        return dependencies.json(result);
      } catch (error) {
        return dependencies.errorResponse(error);
      }
    },
    async get() {
      return dependencies.json(
        { error: "Patient search accepts secure requests only." },
        405,
      );
    },
  };
}

const handlers = createPatientSearchHandlers();

export async function onRequestPost(context) {
  return handlers.post(context);
}

export async function onRequestGet(context) {
  return handlers.get(context);
}
