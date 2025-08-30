// app/api/awn-chat/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Accept comma-separated list; support "*" for quick testing
const RAW = (process.env.ALLOWED_HOSTS || "awnationwide.com,www.awnationwide.com,aw-nationwide-movers.webflow.io,localhost").trim();
const ALLOWED = RAW.split(",").map(s => s.trim()).filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;                 // same-origin / server-to-server
  if (ALLOWED.includes("*")) return true;   // wildcard testing
  try {
    const host = new URL(origin).hostname;
    return ALLOWED.some(a => host === a || host.endsWith("." + a));
  } catch { return false; }
}

function corsHeaders(origin) {
  const allow = ALLOWED.includes("*") ? "*" : (origin || "");
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function guard(req) {
  const origin = req.headers.get("origin");
  return { ok: isAllowedOrigin(origin), origin };
}

// ---- Prompt ----
const SYSTEM_PROMPT = `
You are the website chat assistant for AW Nationwide Movers (AWN).
[...same content as before...]
When user says "reserve" OR you have all required fields, output ONLY the JSON described earlier.
`;

const FEW_SHOTS = [
  { role: "user", content: "Hi, I need help with a 2BR move on Oct 12 from 30309 to 30030" },
  { role: "assistant", content: "I'd love to help with your October 12th move! We have morning and afternoon windows available. To hold a spot and get you a fast written estimate, what's your full name, best email, and phone? Any stairs or elevators at pickup and drop-off?" },
  { role: "user", content: "How much will this cost?" },
  { role: "assistant", content: "Price depends on distance, inventory, building access, and any packing needs. For a 2BR local move like yours, I can share a ballpark range if helpful, then lock in your exact number after a quick 5-minute virtual walkthrough. Would you like to reserve a crew window now or schedule the walkthrough first?" },
  { role: "user", content: "What's required to reserve?" },
  { role: "assistant", content: "To reserve your spot, we take a 50% deposit. The remaining 50% is due prior to packing the truck on moving day. We also offer Affirm financing with 6 or 12-month payment plans, subject to credit approval. Would you prefer the morning or afternoon window for October 12th?" }
];

// ---- CORS preflight
export async function OPTIONS(req) {
  const { ok, origin } = guard(req);
  return new Response(null, { status: ok ? 204 : 403, headers: corsHeaders(origin) });
}

// ---- Health
export async function GET(req) {
  const { ok, origin } = guard(req);
  const body = { ok, route: "awn-chat", origin, allowed: ALLOWED, runtime };
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 403,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// ---- Chat
export async function POST(req) {
  const { ok, origin } = guard(req);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Forbidden origin", origin, allowed: ALLOWED }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  try {
    const { history = [], force_json = false } = await req.json();

    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...FEW_SHOTS, ...history];
    if (force_json) {
      messages.push({ role: "user", content: "If you have all required fields, output ONLY the LeadCapture JSON now." });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.4,
    });

    const reply = completion.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  } catch (err) {
    // Always include CORS on errors
    return new Response(JSON.stringify({ error: "upstream_openai", detail: String(err?.message || err) }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }
}
