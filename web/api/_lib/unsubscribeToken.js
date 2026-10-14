// Signed one-click unsubscribe tokens for /u/<token>. The token carries the
// email and the sending company, HMAC-SHA256 signed with UNSUBSCRIBE_SECRET,
// so the link works without a login and can't be forged for someone else. No
// expiry on purpose: CAN-SPAM requires the opt-out to keep working for 30
// days after the send, and an old link that still works is harmless.
import { createHmac, timingSafeEqual } from "node:crypto";

const b64url = buf => Buffer.from(buf).toString("base64url");

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createUnsubscribeToken({ email, companyId }, secret) {
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not configured.");
  const payload = b64url(JSON.stringify({ e: String(email).trim().toLowerCase(), c: companyId || null }));
  return `${payload}.${sign(payload, secret)}`;
}

// { email, companyId } or null.
export function verifyUnsubscribeToken(token, secret) {
  if (!secret || typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { e, c } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof e === "string" && e ? { email: e, companyId: c || null } : null;
  } catch {
    return null;
  }
}
