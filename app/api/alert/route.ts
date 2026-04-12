import { NextRequest, NextResponse } from "next/server";
import { getAlertRecipients, formatAlertMessage, buildAlertSubject, detectUniversity } from "@/lib/alert-routing";
import { AlertPayload } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body: AlertPayload = await req.json();

    if (!body.location?.lat || !body.location?.lng) {
      return NextResponse.json({ error: "Location is required" }, { status: 400 });
    }

    // Detect university from email domain
    let university = undefined;
    if (body.userEmail) {
      university = detectUniversity(body.userEmail) ?? undefined;
      if (university) {
        body.universityDomain = university.domain;
      }
    }

    const recipients = getAlertRecipients(body);
    const subject = buildAlertSubject(university);
    const message = formatAlertMessage(body);

    // In production, integrate with SendGrid / Resend / AWS SES here.
    // For now, log the alert and return success.
    console.log("[ALERT]", {
      subject,
      recipients,
      message,
      timestamp: body.timestamp,
    });

    return NextResponse.json({
      success: true,
      alertId: `alert_${Date.now()}`,
      recipients,
      university: university?.name ?? null,
    });
  } catch (err) {
    console.error("[alert]", err);
    return NextResponse.json(
      { error: "Failed to send alert" },
      { status: 500 }
    );
  }
}
