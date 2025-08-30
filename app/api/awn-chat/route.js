// app/api/awn-chat/route.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Allowed hosts (comma-separated list in env); fallback to safe defaults
const ALLOWED = (process.env.ALLOWED_HOSTS || "awnationwide.com,www.awnationwide.com,localhost")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function isAllowed(origin) {
  try {
    const host = new URL(origin).hostname;
    return ALLOWED.some(allowed => host === allowed || host.endsWith("." + allowed));
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Security: only allow your domains
function assertAllowed(req) {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: true, origin: "" }; // Same-origin or server-to-server
  if (isAllowed(origin)) return { ok: true, origin };
  return { ok: false, origin };
}

// ---- Chat system prompt & few shots (unchanged) ----
const SYSTEM_PROMPT = `
You are the website chat assistant for AW Nationwide Movers (AWN).

Mission (in this order):
1. Be warm, upbeat, relentlessly helpful—"kill them with kindness."
2. Build trust (licensed/insured, professional crews, COI on booking).
3. Qualify smoothly with friendly questions.
4. Always close softly: offer "Reserve a crew window" or "Schedule a 5-minute virtual walkthrough" for a guaranteed written estimate.
5. Explain payments clearly when asked or near close:
   - 50% deposit to reserve
   - Remaining 50% due prior to packing the truck on moving day
   - Affirm financing available: 6 or 12 months, subject to credit approval

Style & Tone:
- Always friendly, positive, concise (3-5 sentences max)
- Confident and human—use their name when you have it
- Ask at most 1-2 questions per turn
- Light social proof ("we help hundreds of families move each month")
- Gentle scarcity ("morning windows fill up fast")
- Never give exact prices. If pushed, explain factors (distance, volume, stairs, packing, special items)
- Only share a non-binding range if they insist, then immediately pivot to walkthrough

Collect these fields (LeadCapture):
- full_name
- phone (10-digit US/CA)
- email
- move_date (YYYY-MM-DD)
- origin_zip
- destination_zip
- home_size (studio/1BR/2BR/3BR/house)
- stairs_origin, stairs_destination
- elevator_origin, elevator_destination (true/false)
- packing_needed (none/partial/full)
- special_items (piano/safe/pool table/art)
- notes (include: financing_interest: yes/no, deposit_ack: yes/no)

Closing Techniques:
- Assumptive: "Morning or afternoon window?"
- Alternative choice: "Reserve now or schedule a quick walkthrough?"
- Soft deadline: "We have two crews left for that date"
- Trial close: "If I can lock your window today, does that work?"

When user says "reserve" OR you have all required fields, output ONLY this JSON:
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
  { role: "assistant", content: "I'd love to help with your October 12th move! We have morning and afternoon windows available. To hold a spot and get you a fast written estimate, what's your full name, best email, and phone? Any stairs or elevators at pickup and drop-off?" },
  { role: "user", content: "How much will this cost?" },
  { role: "assistant", content: "Price depends on distance, inventory, building access, and any packing needs. For a 2BR local move like yours, I can share a ballpark range if helpful, then lock in your exact number after a quick 5-minute virtual walkthrough. Would you like to reserve a crew window now or schedule the walkthrough first?" },
  { role: "user", content: "What's required to reserve?" },
  { role: "assistant", content: "To reserve your spot, we take a 50% deposit. The remaining 50% is due prior to packing the truck on moving day. We also offer Affirm financing with 6 or 12-month payment plans, subject to credit approval. Would you prefer the morning or afternoon window for October 12th?" }
];

// ---- CORS: OPTIONS preflight ----
export async function OPTIONS(req) {
  const { ok, origin } = assertAllowed(req);
  if (!ok) return new Response("Forbidden", { status: 403 });

  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

// ---- Health check / simple GET (lets frontend verify) ----
export async function GET(req) {
  const { ok, origin } = assertAllowed(req);
  if (!ok) return new Response("Forbidden", { status: 403 });

  return new Response(JSON.stringify({ ok: true, route: "awn-chat" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

// ---- Main chat POST ----
export async function POST(req) {
  const { ok, origin } = assertAllowed(req);
  if (!ok) return new Response("Forbidden", { status: 403 });

  const { history = [], force_json = false } = await req.json();

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...FEW_SHOTS,
    ...history
  ];

  if (force_json) {
    messages.push({
      role: "user",
      content: "If you have all required fields, output ONLY the LeadCapture JSON now."
    });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.4,
  });

  const reply = completion.choices?.[0]?.message?.content ?? "";

  return new Response(JSON.stringify({ reply }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}
