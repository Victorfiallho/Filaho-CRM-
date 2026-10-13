// Small request/response helpers shared by the public (no-login) endpoints.

// Vercel parses urlencoded bodies into a plain object, which loses repeated
// keys (services=a&services=b). Read the raw stream instead when it's still
// unread; fall back to whatever Vercel already parsed.
export async function readForm(req) {
  if (typeof req.body === "string") return new URLSearchParams(req.body);
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.body)) for (const item of [].concat(v)) params.append(k, String(item));
    return params;
  }
  if (Buffer.isBuffer(req.body)) return new URLSearchParams(req.body.toString("utf8"));
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw Object.assign(new Error("Request body too large."), { status: 413 });
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

// Vercel sets x-forwarded-for / x-real-ip itself (client-supplied values are
// overwritten at the edge), so the first entry is the real client.
export function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (fwd || String(req.headers["x-real-ip"] || "") || req.socket?.remoteAddress || "").slice(0, 64);
}

export function userAgent(req) {
  return String(req.headers["user-agent"] || "").slice(0, 500);
}

// PUBLIC_BASE_URL (e.g. https://book.example.com) wins when set, so canonical
// URLs and consent page_url never depend on a Host header.
export function origin(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost");
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${host}`;
}

export function query(req) {
  return new URL(req.url || "/", "http://x").searchParams;
}

export function sendHtml(res, status, html, headers = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(html);
}
