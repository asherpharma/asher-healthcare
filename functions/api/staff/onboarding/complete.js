import {
  commitWrites,
  getDocument,
  requireActiveStaff,
  updateDocumentWrite,
} from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
} from "../../../../server/razorpay/http.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const staffMember = await requireActiveStaff(context.request, context.env);
    const staffPath = `staff/${staffMember.uid}`;
    const staff = await getDocument(context.env, staffPath);

    if (!staff || !["pending", "expired"].includes(staff.data.inviteStatus)) {
      return json({ accepted: false });
    }

    const acceptedAt = new Date();
    await commitWrites(context.env, [
      updateDocumentWrite(
        context.env,
        staffPath,
        {
          inviteStatus: "accepted",
          inviteAcceptedAt: acceptedAt,
          inviteAcceptedBy: staffMember.uid,
          updatedAt: acceptedAt,
        },
        ["inviteStatus", "inviteAcceptedAt", "inviteAcceptedBy", "updatedAt"],
        staff.updateTime,
      ),
    ]);

    return json({ accepted: true, acceptedAt: acceptedAt.toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
