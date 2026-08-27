const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const ALLOWED_HOSTS = new Set([
  "the-leinhos-l4yer.pages.dev",
  "development.the-leinhos-l4yer.pages.dev",
]);

const LIMITS = {
  name: 100,
  email: 254,
  company: 120,
  subject: 140,
  message: 4000,
};

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(value) {
  return value.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function safeHeader(value) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

async function rateLimit(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const periodSeconds = 15 * 60;
  const maxRequests = 3;
  const bucket = Math.floor(Date.now() / (periodSeconds * 1000));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}:${bucket}:contact-v1`));
  const id = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = new Request(`https://rate-limit.invalid/contact/${id}`);
  const cache = caches.default;
  const existing = await cache.match(key);
  const count = existing ? Number(await existing.text()) || 0 : 0;

  if (count >= maxRequests) return false;

  await cache.put(key, new Response(String(count + 1), {
    headers: { "Cache-Control": `max-age=${periodSeconds}` },
  }));
  return true;
}

async function verifyTurnstile(token, request, secret) {
  const ip = request.headers.get("CF-Connecting-IP") || undefined;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return { success: false };
  return response.json();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  const originHost = (() => {
    try { return new URL(origin).hostname; } catch { return ""; }
  })();

  if (!origin || !ALLOWED_HOSTS.has(originHost)) {
    return json(403, { ok: false, code: "origin_rejected" });
  }

  const contentType = request.headers.get("Content-Type") || "";
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (!contentType.toLowerCase().startsWith("application/json") || contentLength > 12000) {
    return json(415, { ok: false, code: "invalid_request" });
  }

  if (!env.BREVO_API_KEY || !env.TURNSTILE_SECRET || !env.CONTACT_RECIPIENT || !env.CONTACT_SENDER_EMAIL) {
    return json(503, { ok: false, code: "service_unavailable" });
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json(400, { ok: false, code: "invalid_json" });
  }

  const name = clean(data.name);
  const email = clean(data.email).toLowerCase();
  const company = clean(data.company);
  const subject = clean(data.subject);
  const message = clean(data.message);
  const website = clean(data.website);
  const token = clean(data.turnstile_token);
  const started = Number(data.form_started);
  const elapsed = Date.now() - started;

  // Honeypot submissions receive a neutral success response.
  if (website) return json(200, { ok: true });

  if (!name || name.length > LIMITS.name || !validEmail(email) ||
      company.length > LIMITS.company || !subject || subject.length > LIMITS.subject ||
      message.length < 20 || message.length > LIMITS.message || !token ||
      !Number.isFinite(started) || elapsed < 3000 || elapsed > 2 * 60 * 60 * 1000) {
    return json(400, { ok: false, code: "validation_failed" });
  }

  const turnstile = await verifyTurnstile(token, request, env.TURNSTILE_SECRET);
  if (!turnstile.success || turnstile.hostname !== originHost || turnstile.action !== "contact") {
    return json(403, { ok: false, code: "turnstile_failed" });
  }

  if (!(await rateLimit(request))) {
    return json(429, { ok: false, code: "rate_limited" }, { "Retry-After": "900" });
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeCompany = escapeHtml(company || "Nicht angegeben / Not provided");
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const mailSubject = `[Leinhos L4yer] ${safeHeader(subject).slice(0, LIMITS.subject)}`;

  const brevoPayload = {
    sender: {
      name: env.CONTACT_SENDER_NAME || "The Leinhos L4yer",
      email: env.CONTACT_SENDER_EMAIL,
    },
    to: [{ email: env.CONTACT_RECIPIENT, name: "Patrick Leinhos" }],
    replyTo: { email, name },
    subject: mailSubject,
    textContent: `Neue Portfolio-Anfrage\n\nName: ${name}\nE-Mail: ${email}\nUnternehmen: ${company || "Nicht angegeben"}\nBetreff: ${subject}\n\nNachricht:\n${message}`,
    htmlContent: `<h2>Neue Portfolio-Anfrage</h2><p><strong>Name:</strong> ${safeName}<br><strong>E-Mail:</strong> ${safeEmail}<br><strong>Unternehmen:</strong> ${safeCompany}<br><strong>Betreff:</strong> ${safeSubject}</p><p><strong>Nachricht:</strong><br>${safeMessage}</p>`,
    headers: {
      "X-Mailin-custom": "source:portfolio-contact",
    },
  };

  let brevoResponse;
  try {
    brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "api-key": env.BREVO_API_KEY,
      },
      body: JSON.stringify(brevoPayload),
    });
  } catch {
    return json(502, { ok: false, code: "delivery_failed" });
  }

  if (!brevoResponse.ok) {
    // Do not expose provider responses or confidential configuration to the browser.
    return json(502, { ok: false, code: "delivery_failed" });
  }

  return json(200, { ok: true });
}

export function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json(405, { ok: false, code: "method_not_allowed" }, { "Allow": "POST" });
}
