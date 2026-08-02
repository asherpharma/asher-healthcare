import {
  commitWrites,
  createAuthUser,
  createDocumentWrite,
  createRandomPassword,
  deleteAuthUser,
  requireAdminStaff,
  sendPasswordResetEmail,
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
const STAFF_INVITE_CONTINUE_URL = "https://asherhealthcare.in/admin/login?welcome=1";

export async function onRequestPost(context) {
  let createdUid = "";
  try {
    assertSameOrigin(context.request);
    const administrator = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request);
    const displayName = String(body.displayName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "");
    const doctorName = String(body.doctorName || "").trim();

    if (displayName.length < 2 || displayName.length > 100) {
      throw new HttpError(400, "Enter the staff member’s full name.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) {
      throw new HttpError(400, "Enter a valid staff email address.");
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
      password: createRandomPassword(),
    });
    createdUid = user.localId;
    await sendPasswordResetEmail(context.env, email, STAFF_INVITE_CONTINUE_URL);

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
        inviteStatus: "pending",
        invitedAt: now,
        invitedBy: administrator.uid,
        inviteEmailSentAt: now,
        inviteEmailLastAttemptAt: now,
        inviteEmailLastAttemptBy: administrator.uid,
        updatedAt: now,
      }),
    ]);

    return json({
      uid: createdUid,
      displayName,
      email,
      role,
      active: true,
      inviteStatus: "pending",
      inviteEmailSentAt: now.toISOString(),
    }, 201);
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
