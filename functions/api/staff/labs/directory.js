import {
  doctorUrgentLabDirectoryPageForStaff,
  labOrderDirectoryForStaff,
  urgentDoctorLabDirectoryForStaff,
} from "../../../../server/labs/directory.js";
import { requireActiveStaff } from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
} from "../../../../server/razorpay/http.js";

export async function labDirectoryForStaffView(
  env,
  staff,
  requestUrl,
  dependencies = {},
) {
  const url = new URL(requestUrl);
  const view = url.searchParams.get("view") || "";
  if (!["", "today-urgent", "doctor-urgent"].includes(view)) {
    throw new HttpError(400, "This lab directory view is not supported.");
  }
  if (view === "today-urgent") {
    const loadToday = dependencies.urgentDoctorLabDirectoryForStaff
      || urgentDoctorLabDirectoryForStaff;
    return loadToday(env, staff, dependencies);
  }
  if (view === "doctor-urgent") {
    const loadDoctorUrgentPage = dependencies.doctorUrgentLabDirectoryPageForStaff
      || doctorUrgentLabDirectoryPageForStaff;
    return loadDoctorUrgentPage(
      env,
      staff,
      {
        cursor: url.searchParams.get("cursor") || "",
        pageSize: url.searchParams.get("pageSize") || undefined,
      },
      dependencies,
    );
  }
  const loadDirectory = dependencies.labOrderDirectoryForStaff
    || labOrderDirectoryForStaff;
  return loadDirectory(env, staff, dependencies);
}

export async function onRequestGet(context) {
  try {
    assertSameOrigin(context.request);
    const staff = await requireActiveStaff(context.request, context.env);
    const directory = await labDirectoryForStaffView(
      context.env,
      staff,
      context.request.url,
    );
    return json(directory);
  } catch (error) {
    return errorResponse(error);
  }
}
