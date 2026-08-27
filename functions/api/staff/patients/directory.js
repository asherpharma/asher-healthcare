import {
  patientDirectoryPageForStaff,
  resolvePatientDirectoryEntriesForStaff,
} from "../../../../server/patients/directory.js";
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
  patientDirectoryPageForStaff,
  readJson,
  requireActiveStaff,
  resolvePatientDirectoryEntriesForStaff,
};

export function createPatientDirectoryHandlers(dependencies = defaultDependencies) {
  return {
    async get(context) {
      try {
        dependencies.assertSameOrigin(context.request);
        const staff = await dependencies.requireActiveStaff(context.request, context.env);
        const url = new URL(context.request.url);
        const result = await dependencies.patientDirectoryPageForStaff(
          context.env,
          staff,
          {
            includeArchived: url.searchParams.get("includeArchived") === "1",
            archivedOnly: url.searchParams.get("archivedOnly") === "1",
            cursor: url.searchParams.get("cursor") || "",
            pageSize: url.searchParams.get("pageSize") || undefined,
          },
        );
        return dependencies.json(result);
      } catch (error) {
        return dependencies.errorResponse(error);
      }
    },
    async post(context) {
      try {
        dependencies.assertSameOrigin(context.request);
        const staff = await dependencies.requireActiveStaff(context.request, context.env);
        const body = await dependencies.readJson(context.request, 10_000);
        const result = await dependencies.resolvePatientDirectoryEntriesForStaff(
          context.env,
          staff,
          {
            patientIds: body?.patientIds,
            includeArchived: body?.includeArchived === true,
          },
        );
        return dependencies.json(result);
      } catch (error) {
        return dependencies.errorResponse(error);
      }
    },
  };
}

// Compatibility export for tests or callers that only need the GET handler.
export function createPatientDirectoryHandler(dependencies = defaultDependencies) {
  return createPatientDirectoryHandlers(dependencies).get;
}

const handlers = createPatientDirectoryHandlers();

export async function onRequestGet(context) {
  return handlers.get(context);
}

export async function onRequestPost(context) {
  return handlers.post(context);
}
