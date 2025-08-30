// app/api/awn-chat/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import OpenAI from "openai";

const RAW = (process.env.ALLOWED_HOSTS || "awnationwide.com,www.awnationwide.com,aw-nationwide-movers.webflow.io,localhost").trim();
const ALLOWED = RAW.split(",").map(s => s.trim()).filter(Boolean);
const CHAT_BYPASS = (process.env.CHAT_BYPASS || "").toString() === "1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED.includes("*")) return true;
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

// ---------- Prompt ----------
const SYSTEM_PROMPT = `
You are the website chat assistant for AW Nationwide Movers (AWN).

Mission (in this order):
1) Be warm, upbeat, relentlessly helpful.
2) Build trust (licensed/insured, professional crews, COI on booking).
3) Qualify smoothly with friendly questions.
4) Close softly: "Reserve a crew window" or "Schedule a 5-minute virtual walkthrough".
5) Payments when asked/near close:
   - 50% deposit to reserve
   - 50% due prior to packing the truck on moving day
   - Affirm financing: 6 or 12 months, subject to credit approval

Style:
- Friendly, concise (3–5 sentences), use their name when known, 1–2 questions per turn.
- No exact prices; discuss factors. Share a soft range only if pushed, then pivot to walkthrough.

Collect (LeadCapture):
- full_name, phone (10-digit US/CA), email, move_date (YYYY-MM-DD),
- origin_zip, destination_zip, home_size (studio/1BR/2BR/3BR/house),
- stairs_origin, stairs_destination, elevator_origin (true/false), elevator_destination (true/false),
- packing_needed (none/partial/full), special_items (piano/safe/pool table/art), notes (include financing_interest, deposit_ack).

Close techniques:
- Assumptive (“Morning or afternoon window?”)
- Alternative choice
- Soft deadline (“two crews left for that date”)
- Trial close

When user says "reserve" OR all fields are present, output ONLY this JSON:
{
  "full_name": "string",
  "phone": "string",
  "email": "string",
  "move_date": "YYYY-MM-DD",
  "origin_zip": "string",
  "destination_zip": "string",
  "home_size": "string",
  "stairs_origin": "string",
  "stairs_destination": "string",
  "elevator_origin": true/false,
  "elevator_destination": true/false,
  "packing_needed": "string",
  "special_items": "string",
  "notes": "string"
}
`;

const FEW_SHOTS = [
  { role: "user", content: "Hi, I need help with a 2BR move on Oct 12 from 30309 to 30030" },
  { role: "assistant", content: "I’d love to help with your Oct 12 move! We have morning and afternoon windows available. To hold a spot and get you a fast written estimate, what’s your full name, best email, and phone? Any stairs or elevators at pickup and drop-off?" },
  { role: "user", content: "How much will this cost?" },
  { role: "assistant", content: "It depends on distance, inventory, access, and packing. I can share a ballpark if helpful, then lock in your exact number after a quick 5-minute virtual walkthrough. Would you like to reserve a crew window now or schedule the walkthrough first?" },
  { role: "user", content: "What’s required to reserve?" },
  { role: "assistant", content: "To reserve, we take a 50% deposit; the remaining 50% is due prior to packing the truck on moving day. We also offer Affirm financing (6 or 12 months, subject to credit approval). Do you prefer the morning or afternoon window?" }
];

// ---------- Preflight ----------
export async function OPTIONS(req) {
  const { ok, origin } = guard(req);
  return new Response(null, { status: ok ? 204 : 403, headers: corsHeaders(origin) });
}

// ---------- Health / Diagnostics ----------
export async function GET(req) {
  const { ok, origin } = guard(req);
  const url = new URL(req.url);
  const diag = url.searchParams.get("diag") === "1";
  const body = {
    ok,
    route: "awn-chat",
    origin,
    allowed: ALLOWED,
    env: {
      hasOpenAI: !!OPENAI_API_KEY,
      bypass: CHAT_BYPASS,
    },
    hint: "Set ALLOWED_HOSTS in Vercel (Production). Optional: CHAT_BYPASS=1 to skip OpenAI temporarily."
  };
  return new Response(JSON.stringify(diag ? body : { ok, route: "awn-chat" }), {
    status: ok ? 200 : 403,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// ---------- Chat ----------
export async function POST(req) {
  const { ok, origin } = guard(req);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Forbidden origin", allowed: ALLOWED }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  try {
    const { history = [], force_json = false } = await req.json();

    // Bypass mode for quick success while configuring OpenAI/billing
    if (CHAT_BYPASS) {
      const needsJson = /"full_name"|origin_zip|destination_zip|move_date/.test(JSON.stringify(history));
      const reply = needsJson
        ? JSON.stringify({
            full_name: "Test User",
            phone: "4045551234",
            email: "test@example.com",
            move_date: "2025-10-15",
            origin_zip: "30309",
            destination_zip: "30030",
            home_size: "2br",
            stairs_origin: "none",
            stairs_destination: "1 flight",
            elevator_origin: false,
            elevator_destination: false,
            packing_needed: "partial",
            special_items: "none",
            notes: "financing_interest: yes; deposit_ack: yes"
          })
        : "Great news — we have crews available. What’s your move date and the ZIPs you’re moving between?";
      return new Response(JSON.stringify({ reply }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "missing_openai_key" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
    return new Response(JSON.stringify({ error: "upstream_openai", detail: String(err?.message || err) }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }
}
