// Sends the delivery OTP by SMS via a local Ethiopian bulk-SMS gateway.
//
// There's no single fixed API across these providers (AfroMessage, Geez SMS,
// YegnaSMS, etc. each have their own endpoint URL, auth style, and request
// field names) — so this is deliberately generic and configured entirely
// through environment variables, rather than hardcoding one provider's API
// shape. Pick a gateway, sign up, and set these from ITS docs:
//
//   SMS_API_URL     the endpoint that sends a single SMS (from your
//                    provider's docs — not guessed or filled in here)
//   SMS_API_KEY      your provider API key/token
//   SMS_SENDER_ID    the approved sender name/ID your provider assigns you
//
// If SMS_API_URL or SMS_API_KEY aren't set, sendOtpSms() no-ops (just logs)
// instead of failing — so order creation keeps working exactly like before
// in local dev with no SMS account configured. The order-creation API
// response only includes the raw otpCode as a fallback in that same
// unconfigured case (see routes/orders.js) — once real SMS is wired up, the
// code stops being handed back over the API.
const SMS_API_URL = process.env.SMS_API_URL || "";
const SMS_API_KEY = process.env.SMS_API_KEY || "";
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || "AderaDelivery";

function isConfigured() {
  return Boolean(SMS_API_URL && SMS_API_KEY);
}

// Most Ethiopian numbers arrive as 09xxxxxxxx or +2519xxxxxxxx — gateways
// generally expect E.164 (+2519xxxxxxxx), so normalize before sending.
function toE164Ethiopia(phone) {
  const digits = String(phone).replace(/[^\d+]/g, "");
  if (digits.startsWith("+251")) return digits;
  if (digits.startsWith("251")) return `+${digits}`;
  if (digits.startsWith("0")) return `+251${digits.slice(1)}`;
  return `+251${digits}`;
}

// Fire-and-forget from the caller's perspective: this never throws or
// rejects. A down/misconfigured SMS gateway should never block order
// creation — it just means the OTP wasn't texted, logged here for
// visibility.
async function sendOtpSms(phone, otp) {
  if (!isConfigured()) {
    console.log(`[sms] not configured (SMS_API_URL/SMS_API_KEY unset) — skipping SMS to ${phone}`);
    return { sent: false, reason: "not_configured" };
  }

  const to = toE164Ethiopia(phone);
  const message = `Adera Delivery: your delivery confirmation code is ${otp}. Share this only with your courier at handoff.`;

  try {
    const res = await fetch(SMS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SMS_API_KEY}`,
      },
      // NOTE: field names below (to/message/sender_id) are a generic guess,
      // not any specific gateway's real contract — replace this body to
      // match whatever gateway you actually sign up with.
      body: JSON.stringify({ to, message, sender_id: SMS_SENDER_ID }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[sms] send failed (${res.status}) to ${to}: ${text}`);
      return { sent: false, reason: "provider_error", status: res.status };
    }

    return { sent: true };
  } catch (err) {
    console.error(`[sms] send threw for ${to}:`, err.message);
    return { sent: false, reason: "network_error" };
  }
}

module.exports = { sendOtpSms, isConfigured, toE164Ethiopia };
