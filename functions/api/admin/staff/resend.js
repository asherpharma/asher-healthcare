import {
  commitWrites,
  getDocument,
  requireAdminStaff,
  sendPasswordResetEmail,
  updateDocumentWrite,
} from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../../server/razorpay/http.js";

const STAFF_INVITE_CONTINUE_URL = "https://asherhealthcare.in/admin/login?welcome=1";
const RESEND_COOLDOWN_MS = 60_000;

function inviteTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const administrator = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request);
    const uid = String(body.uid || "").trim();

    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(uid)) {
      throw new HttpError(400, "Choose a valid staff account.");
    }

    const staffPath = `staff/${uid}`;
    const staff = await getDocument(context.env, staffPath);
    if (!staff) {
      throw new HttpError(404, "This staff account could not be found.");
    }
    if (staff.data.active !== true) {
      throw new HttpError(409, "Reactivate this staff account before sending a new invitation.");
    }

    const email = String(staff.data.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) {
      throw new HttpError(409, "This staff account does not have a valid invitation email.");
    }

    const lastAttemptAt = Math.max(
      inviteTimestamp(staff.data.inviteEmailLastAttemptAt),
      inviteTimestamp(staff.data.inviteEmailSentAt),
    );
    const remainingMs = RESEND_COOLDOWN_MS - (Date.now() - lastAttemptAt);
    if (remainingMs > 0) {
      const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      throw new HttpError(429, `Please wait ${remainingSeconds} seconds before resending this invitation.`);
    }

    // Reserve the send before contacting Firebase. The update-time precondition
    // ensures concurrent resend requests cannot both send an email.
    const attemptAt = new Date();
    await commitWrites(context.env, [
      updateDocumentWrite(
        context.env,
        staffPath,
        {
          inviteEmailLastAttemptAt: attemptAt,
          inviteEmailLastAttemptBy: administrator.uid,
          updatedAt: attemptAt,
        },
        ["inviteEmailLastAttemptAt", "inviteEmailLastAttemptBy", "updatedAt"],
        staff.updateTime,
      ),
    ]);

    await sendPasswordResetEmail(context.env, email, STAFF_INVITE_CONTINUE_URL);

    const sentAt = new Date();
    const inviteStatus = staff.data.inviteStatus === "accepted" || !staff.data.inviteStatus
      ? "accepted"
      : "pending";
    const reservedStaff = await getDocument(context.env, staffPath);
    if (!reservedStaff) {
      throw new HttpError(409, "This staff account changed while the invitation was being sent.");
    }
    await commitWrites(context.env, [
      updateDocumentWrite(
        context.env,
        staffPath,
        {
          inviteStatus,
          inviteEmailSentAt: sentAt,
          inviteEmailLastAttemptAt: sentAt,
          inviteEmailLastAttemptBy: administrator.uid,
          invitedBy: administrator.uid,
          updatedAt: sentAt,
        },
        [
          "inviteStatus",
          "inviteEmailSentAt",
          "inviteEmailLastAttemptAt",
          "inviteEmailLastAttemptBy",
          "invitedBy",
          "updatedAt",
        ],
        reservedStaff.updateTime,
      ),
    ]);

    return json({
      uid,
      email,
      inviteStatus,
      inviteEmailSentAt: sentAt.toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
