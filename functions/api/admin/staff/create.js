import {
  commitWrites,
  createAuthUser,
  createDocumentWrite,
  deleteAuthUser,
  requireAdminStaff,
} from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../../server/razorpay/http.js";

const STAFF_ROLES = ["admin", "doctor", "reception"];
const DOCTOR_NAMES = ["Dr. Lt Col Shafi Ahamad", "Dr. Shaik Reshma"];

export async function onRequestPost(context) {
  let createdUid = "";
  try {
    assertSameOrigin(context.request);
    const administrator = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request);
    const displayName = String(body.displayName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = String(body.role || "");
    const doctorName = String(body.doctorName || "").trim();

    if (displayName.length < 2 || displayName.length > 100) {
      throw new HttpError(400, "Enter the staff member’s full name.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) {
      throw new HttpError(400, "Enter a valid staff email address.");
    }
    if (password.length < 8 || password.length > 72) {
      throw new HttpError(400, "Use a temporary password between 8 and 72 characters.");
    }
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpError(400, "Choose a valid staff role.");
    }
    if (role === "doctor" && !DOCTOR_NAMES.includes(doctorName)) {
      throw new HttpError(400, "Assign this login to one of the clinic doctors.");
    }

    const user = await createAuthUser(context.env, {
      displayName,
      email,
      password,
    });
    createdUid = user.localId;
    const now = new Date();
    await commitWrites(context.env, [
      createDocumentWrite(context.env, `staff/${createdUid}`, {
        uid: createdUid,
        displayName,
        email,
        role,
        doctorName: role === "doctor" ? doctorName : "",
        active: true,
        createdBy: administrator.uid,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    return json({ uid: createdUid, displayName, email, role, active: true }, 201);
  } catch (error) {
    if (createdUid) {
      try {
        await deleteAuthUser(context.env, createdUid);
      } catch (rollbackError) {
        console.error("Could not roll back incomplete staff account", rollbackError);
      }
    }
    return errorResponse(error);
  }
}
