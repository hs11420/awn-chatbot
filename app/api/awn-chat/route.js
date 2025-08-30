// app/api/awn-chat/route.js
export const runtime = "nodejs";

import OpenAI from "openai";

/* -------------------------- C O N F I G  -------------------------- */

const ALLOWED = (process.env.ALLOWED_HOSTS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const openai =
  process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// System prompt used when AI is enabled
const SYSTEM_PROMPT = `
You are the AW Nationwide Movers chatbot.
Goal: be friendly, efficient, and collect details so a coordinator follows up within 24 hours
to confirm the date and finalize a custom quote. NEVER give exact pricing.

Key notes to weave in naturally (not pushy):
- We’re fully licensed and insured.
- Financing is available through Affirm (6 or 12 months, subject to approval).

When the user says they’re ready and you have all fields, output ONLY valid JSON matching:
LeadCapture = {
  full_name: string,
  phone: string,
  email: string,
  move_date: string (YYYY-MM-DD),
  origin_zip: string,
  destination_zip: string,
  service_type: string,          // e.g., residential local, residential long-distance, commercial, packing-only, etc.
  home_size: string,             // e.g., studio, 1BR, 2BR, 3BR, etc. or office size
  stairs_origin: string,         // none / 1 flight / 2+ flights
  stairs_destination: string,    // none / 1 flight / 2+ flights
  elevator_origin: boolean,
  elevator_destination: boolean,
  packing_needed: string,        // none / partial / full
  special_items: string,         // pianos, safes, pool tables, etc.
  promo_code: string,
  referral_code: string,
  notes: string                  // any extra notes; include "financing_interest: yes/no/maybe"
}

Rules:
- If a move is 7+ days out: you can confidently state "we have availability".
- If 4–6 days out: also say "we have availability" but note we’ll confirm time and details.
- If <4 days: say someone will contact them as soon as possible to confirm.
- Always keep tone warm and concise.
`;

// Optional few-shot messages to bias the assistant a bit (safe to keep small)
const FEW_SHOTS = [
  {
    role: "user",
    content: "Can you give me pricing right here?",
  },
  {
    role: "assistant",
    content:
      "I can’t quote exact pricing in chat, but I’ll collect your details so a coordinator follows up within 24 hours with your personalized estimate. What’s your move date and from/to ZIPs?",
  },
];

/* -------------------------- C O R S  -------------------------- */

function isAllowedOrigin(origin) {
  if (!origin) return true; // allow server-to-server
  if (ALLOWED.includes("*")) return true;
  try {
    const url = new URL(origin);
    const host = url.host; // includes subdomain + domain
    return ALLOWED.some((h) => host === h || host.endsWith(`.${h}`) || origin.includes(h));
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const allow = isAllowedOrigin(origin) ? origin || "*" : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

/* -------------------------- H E A L T H  &  P R E F L I G H T  -------------------------- */

export async function OPTIONS(req) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// Simple health endpoint to debug from the browser console
export async function GET(req) {
  const origin = req.headers.get("origin");
  return Response.json(
    {
      ok: true,
      route: "awn-chat",
      origin,
      allowed: ALLOWED,
      env: {
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        bypass: !!process.env.CHAT_BYPASS,
      },
      hint:
        "Set ALLOWED_HOSTS in Vercel (Production). Optional: CHAT_BYPASS=1 to skip OpenAI temporarily.",
    },
    { headers: corsHeaders(origin) }
  );
}

/* -------------------------- P O S T  (main handler) -------------------------- */

export async function POST(req) {
  const origin = req.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders(origin) });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    // ignore; leave body as {}
  }

  const { history = [], force_json = false } = body;

  /* ----------- BYPASS MODE (keeps chat working if AI is down or you set CHAT_BYPASS=1) ----------- */
  const useBypass = !!process.env.CHAT_BYPASS || !openai;
  if (useBypass) {
    // If they explicitly asked to submit, emit JSON the /api/awn-lead expects
    if (force_json) {
      const demo = {
        full_name: "Web Visitor",
        phone: "0000000000",
        email: "visitor@example.com",
        move_date: "2025-09-15",
        origin_zip: "30542",
        destination_zip: "30519",
        service_type: "residential local",
        home_size: "2BR",
        stairs_origin: "none",
        stairs_destination: "none",
        elevator_origin: false,
        elevator_destination: false,
        packing_needed: "partial",
        special_items: "",
        promo_code: "",
        referral_code: "",
        notes: "financing_interest: maybe",
      };
      return Response.json({ reply: JSON.stringify(demo) }, { headers: corsHeaders(origin) });
    }

    // Otherwise send a friendly canned reply
    const last = (history[history.length - 1]?.content || "").toLowerCase();
    let reply =
      "Hi! I’m the AW Nationwide Movers chatbot. I can check availability and collect details so a coordinator follows up within 24 hours to confirm your date and finalize a custom quote. " +
      "What’s your move date and the ZIPs you’re moving between? (We’re fully licensed & insured. Financing via Affirm is available if helpful.)";

    if (/price|quote|cost|estimate/.test(last)) {
      reply =
        "I can’t give exact pricing in chat, but I’ll collect your info so a coordinator follows up within 24 hours with your personalized quote. " +
        "What’s your move date, from ZIP, and to ZIP?";
    }

    return Response.json({ reply }, { headers: corsHeaders(origin) });
  }
  /* ---------------------------------------- END BYPASS ---------------------------------------- */

  // Normal AI path
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...FEW_SHOTS,
    ...history,
  ];

  if (force_json) {
    messages.push({
      role: "user",
      content:
        "If you have all required fields, output ONLY the LeadCapture JSON now. No extra text.",
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages,
    });

    const reply = completion.choices?.[0]?.message?.content ?? "";
    return Response.json({ reply }, { headers: corsHeaders(origin) });
  } catch (e) {
    // Fallback if OpenAI errors—don’t break the widget
    const reply =
      "I’m having trouble reaching our AI right now, but I can still take your details. " +
      "Please share your move date and from/to ZIPs, and I’ll queue this so a coordinator follows up within 24 hours.";
    return Response.json(
      { reply, error: String(e?.message || e) },
      { status: 200, headers: corsHeaders(origin) }
    );
  }
}
