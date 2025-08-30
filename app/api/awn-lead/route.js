// app/api/awn-lead/route.js
// Node runtime (not edge) because we may use SMTP/Resend and external APIs
export const runtime = "nodejs";

import { NextResponse } from "next/server";

// ---- OPTIONAL EMAIL via Resend (recommended) ----
let resend = null;
try {
  // Lazy import to avoid bundling if not used
  const { Resend } = await import("resend");
  if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
} catch (_) { /* no resend */ }

// Utility: safe fetch with timeout
async function safeFetch(url, opts = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

function htmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function leadToLines(lead = {}) {
  const lines = [
    `Service: ${lead.service || "—"}`,
    `Move date: ${lead.move_date || "—"}`,
    `ZIPs: ${lead.from_zip || "—"} → ${lead.to_zip || "—"}`,
    `Home type: ${lead.home_type || "—"}`,
    `Bedrooms: ${lead.bedrooms || "—"}`,
    `Stairs/Elevator: ${lead.stairs || "—"}`,
    `Packing: ${lead.packing || "—"}`,
    `Special items: ${Array.isArray(lead.heavy) && lead.heavy.length ? lead.heavy.join(", ") : "None"}`,
    `First name: ${lead.first_name || "—"}`,
    `Last name: ${lead.last_name || "—"}`,
    `Email: ${lead.email || "—"}`,
    `Phone: ${lead.phone || "—"}`,
    `Promo/Referral: ${lead.promo || "—"}`,
  ];
  return lines;
}

function emailHtml(lead = {}, page_url, ts) {
  const lines = leadToLines(lead).map(line => htmlEscape(line));
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#111">
      <h2 style="margin:0 0 8px 0">New Chat Lead</h2>
      <div style="color:#666;margin:0 0 10px 0">${ts}</div>
      <pre style="white-space:pre-wrap;background:#f7f7f9;border:1px solid #eee;border-radius:8px;padding:10px;line-height:1.5">${lines.join("\n")}</pre>
      ${page_url ? `<div style="margin-top:10px">Page: <a href="${htmlEscape(page_url)}">${htmlEscape(page_url)}</a></div>` : ""}
    </div>
  `;
}

export async function POST(req) {
  const started = Date.now();
  let payload = {};
  try {
    payload = await req.json();
  } catch (_) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { lead = {}, page_url, is_test } = payload || {};
  const ts = new Date().toISOString();

  // ---- Send EMAIL (Resend) ----
  let emailed = false;
  let emailError = null;

  if (resend && process.env.LEAD_TO_EMAIL) {
    try {
      // choose subject
      const subj = `AWN Chat Lead • ${lead.move_date || "date?"} • ${lead.from_zip || "—"}→${lead.to_zip || "—"}`;
      const from = process.env.LEAD_FROM_EMAIL || "leads@awnnationwide.com";
      const to = process.env.LEAD_TO_EMAIL; // can be comma-separated

      await resend.emails.send({
        from,
        to: to.split(",").map(s => s.trim()).filter(Boolean),
        subject: subj,
        html: emailHtml(lead, page_url, ts),
        reply_to: lead.email || undefined,
      });

      emailed = true;
    } catch (err) {
      emailError = String(err?.message || err);
      if (process.env.LEAD_DEBUG) console.error("EMAIL ERROR:", err);
    }
  }

  // ---- Push to SUPERMOVE if configured ----
  // NOTE: Field names vary by account. Adjust mapping to your Supermove schema.
  let supermove = false;
  let supermoveError = null;
  if (process.env.SUPERMOVE_API_KEY && process.env.SUPERMOVE_API_URL) {
    try {
      const smBody = {
        // This mapping is an example. Update keys to match your Supermove API.
        first_name: lead.first_name || "",
        last_name: lead.last_name || "",
        email: lead.email || "",
        phone: lead.phone || "",
        move_date: lead.move_date || "",
        origin_zip: lead.from_zip || "",
        destination_zip: lead.to_zip || "",
        service: lead.service || "",
        home_type: lead.home_type || "",
        bedrooms: lead.bedrooms || "",
        stairs: lead.stairs || "",
        packing: lead.packing || "",
        special_items: Array.isArray(lead.heavy) ? lead.heavy : [],
        promo_code: lead.promo || "",
        source: "Website Chat",
        page_url: page_url || "",
      };

      const res = await safeFetch(process.env.SUPERMOVE_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SUPERMOVE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(smBody),
      }, 15000);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Supermove ${res.status}: ${text.slice(0, 400)}`);
      }
      supermove = true;
    } catch (err) {
      supermoveError = String(err?.message || err);
      if (process.env.LEAD_DEBUG) console.error("SUPERMOVE ERROR:", err);
    }
  }

  // ---- Optional Slack webhook ----
  let slack = false;
  let slackError = null;
  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      const lines = leadToLines(lead);
      const res = await safeFetch(process.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `*New Chat Lead*  (${ts})\n${lines.join("\n")}\n${page_url ? `Page: ${page_url}` : ""}`,
        }),
      }, 12000);
      if (!res.ok) throw new Error(`Slack ${res.status}`);
      slack = true;
    } catch (err) {
      slackError = String(err?.message || err);
      if (process.env.LEAD_DEBUG) console.error("SLACK ERROR:", err);
    }
  }

  const ms = Date.now() - started;
  return NextResponse.json({
    ok: true,
    ms,
    emailed,
    supermove,
    slack,
    errors: {
      email: emailError,
      supermove: supermoveError,
      slack: slackError,
    },
    echo: { is_test: !!is_test },
  });
}

// Simple GET health check (handy for debugging from browser)
export async function GET() {
  return NextResponse.json({
    ok: true,
    targets: {
      email: !!process.env.RESEND_API_KEY && !!process.env.LEAD_TO_EMAIL,
      supermove: !!process.env.SUPERMOVE_API_KEY && !!process.env.SUPERMOVE_API_URL,
      slack: !!process.env.SLACK_WEBHOOK_URL,
    },
  });
}
