// app/api/awn-chat/route.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------- CORS / Allowed Hosts ---------------- */
function parseAllowed() {
  const raw = (process.env.ALLOWED_HOSTS || "").trim();
  if (!raw) return [];
  if (raw === "*" || raw === "*,*") return ["*"];
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
const ALLOWED = parseAllowed();

function isAllowedOrigin(origin) {
  try {
    if (!origin) return true; // server-to-server or same-origin
    if (ALLOWED.includes("*")) return true;
    const host = new URL(origin).hostname;
    return ALLOWED.some(h => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}
function corsHeaders(origin) {
  // Echo the specific origin if allowed; otherwise omit header
  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
  if (!origin || isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin || "*";
  }
  return headers;
}

/* ---------------- Prompt ---------------- */
const SYSTEM_PROMPT = `
You are the AW Nationwide Movers chatbot for awnationwide.com.

Mission & Tone
- Warm, upbeat, relentlessly helpful. Replies are concise (2–5 short sentences), plain English, no jargon.
- We are fully licensed & insured—mention naturally when relevant.
- Affirm financing available (6 or 12 months, subject to credit approval)—mention gently, not pushy.
- Experience note: If the user asks about experience, you may say: "Our team has over 20 years of experience." Do NOT put this in your opening line unless asked.

What you do
- Answer moving questions (availability, timing, services, prep, COI, materials, stairs/elevators/long walks, special/heavy items, packing/unpacking, labor-only, junk removal, senior moves, office/commercial, local & long-distance).
- Do not give exact prices. If asked, explain cost factors. Provide a non-binding range only if they insist, then pivot to coordinator follow-up.
- Offer to check availability and queue details so a coordinator follows up within 24 hours to confirm dates and provide a custom quote.

Availability policy (days from inquiry)
- 7+ days out: You may confirm availability (no pricing). Coordinator will follow up to finalize window & details.
- 4–6 days out: You may confirm availability (no pricing) but emphasize we’ll coordinate the exact window & remaining details via quick follow-up.
- 0–3 days out (short notice): Do NOT confirm availability. Say we'll have someone contact them ASAP to confirm and try to accommodate. Encourage a phone number for urgent contact.
- Avoid promising a specific crew until coordinator confirms.

Conversation style
- Opening: Ask “How can I help?” and show example topics (availability, services, prep, stairs/elevators & specialty items, packing/unpacking, long-distance timing).
- Ask 1–2 questions per turn. Use their name once you have it.
- If they mention a page form, offer a choice: use the page form or share details here. Respect their preference.
- Mention licensed & insured and Affirm gently when relevant.

Lead capture (when they're ready)
- When they say reserve/book/check availability/get a quote/send details—or intent is clear—or all required fields are known—collect:
  - first_name, last_name
  - phone (10-digit US/CA), email
  - move_date (YYYY-MM-DD or convert natural date)
  - origin_zip, destination_zip
  - service_type (local, long-distance/national, residential, apartment/condo, house, office/commercial, senior move, labor-only load/unload, packing, unpacking, concierge/white-glove, junk removal, heavy/specialty items)
  - If residential: home_size (studio/1BR/2BR/3BR/house)
  - Access notes: stairs_origin, stairs_destination; elevator_origin/elevator_destination (true/false)
  - packing_needed (none/partial/full)
  - special_items (piano/safe/pool table/art/large appliances/etc.)
  - promo_code (optional), referral_code (optional)
  - notes (anything else; include whether they’re interested in financing)
- Before final handoff, confirm if they’re interested in financing via Affirm (yes/no/maybe). Include financing_interest: yes/no/maybe in notes.
- Keep it friendly; don’t interrogate.

Output rules
- Normal conversation = plain text.
- When the user says reserve/book/submit/send my details/check availability, OR all required fields are collected, OR force_json=true, output ONLY this JSON (no extra text):
{
  "full_name": "First Last",
  "phone": "##########",
  "email": "user@example.com",
  "move_date": "YYYY-MM-DD",
  "origin_zip": "#####",
  "destination_zip": "#####",
  "service_type": "string",
  "home_size": "studio|1BR|2BR|3BR|house",
  "stairs_origin": "string",
  "stairs_destination": "string",
  "elevator_origin": true/false,
  "elevator_destination": true/false,
  "packing_needed": "none|partial|full",
  "special_items": "string",
  "promo_code": "string",
  "referral_code": "string",
  "notes": "string (include: financing_interest: yes/no/maybe)"
}
- If something required is missing, do not output partial JSON—ask a friendly follow-up question instead.

Closers (after successful submit)
- End with: "In the next 24 hours, a coordinator will reach out to confirm your move-in date and finalize your personalized quote."
- Then append ONE randomly selected closer:
  1) "Thank you for choosing AW Nationwide Movers as your trusted moving partner."
  2) "We’re honored you chose AW Nationwide Movers. Let’s get you moving."
  3) "Thanks for trusting AW Nationwide Movers with your move."
`;

const FEW_SHOTS = [
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hi! 👋 I’m the AW Nationwide Movers chatbot—how can I help today? For example: check a date’s availability, explain services (local/long-distance, packing/unpacking, labor-only, senior or office moves), what to prep before moving day, or how we handle stairs/elevators & specialty items. We’re fully licensed & insured, and Affirm financing is available if helpful." },
  { role: "user", content: "Are you free for Sept 25?" },
  { role: "assistant", content: "I can check that—what ZIPs are you moving between, and is this residential or office? If it’s 7+ days out, we have availability; I’ll queue details so a coordinator follows up within 24 hours to finalize your window and next steps." },
  { role: "user", content: "Move is in 2 days." },
  { role: "assistant", content: "For short-notice (0–3 days), we’ll have someone contact you as soon as possible to confirm and try to accommodate. Could I grab your first & last name and the best phone number for urgent follow-up?" },
  { role: "user", content: "How experienced are you?" },
  { role: "assistant", content: "Our team has over 20 years of experience. Would you like me to check availability for your date?" }
];

/* ---------------- Handlers ---------------- */
export async function OPTIONS(req) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(req) {
  const origin = req.headers.get("origin");
  return Response.json(
    {
      ok: true,
      route: "awn-chat",
      origin: origin || null,
      allowed: ALLOWED,
      env: { hasOpenAI: !!process.env.OPENAI_API_KEY, bypass: !!process.env.CHAT_BYPASS },
      hint: "CORS active. Set ALLOWED_HOSTS in Vercel (Production)."
    },
    { headers: corsHeaders(origin) }
  );
}

export async function POST(req) {
  const origin = req.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders(origin) });
  }

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

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages
    });
    const reply = completion.choices?.[0]?.message?.content ?? "";
    return Response.json({ reply }, { headers: corsHeaders(origin) });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers: corsHeaders(origin) });
  }
}
