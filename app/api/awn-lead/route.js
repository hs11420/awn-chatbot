// app/api/awn-lead/route.js

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
    if (!origin) return true;
    if (ALLOWED.includes("*")) return true;
    const host = new URL(origin).hostname;
    return ALLOWED.some(h => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}
function corsHeaders(origin) {
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

/* ---------------- Helpers ---------------- */
function normalizePhone(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  throw new Error("Invalid phone");
}

// Map to your Supermove labels
const SIZE_MAP = {
  "studio": "Studio",
  "1br": "1 bedroom",
  "2br": "2 bedroom",
  "3br": "3 bedroom",
  "house": "3 bedroom+"
};
function mapSize(s) { return SIZE_MAP[(s || "").toLowerCase()] || null; }

/* ---------------- Handlers ---------------- */
export async function OPTIONS(req) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req) {
  const origin = req.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders(origin) });
  }

  const body = await req.json();
  const { lead, utm = {}, page_url, is_test = false } = body || {};

  if (!lead) {
    return Response.json({ ok: false, error: "Missing lead" }, { status: 400, headers: corsHeaders(origin) });
  }

  try {
    const phone_number = normalizePhone(lead.phone);

    const payload = {
      full_name: lead.full_name || `${lead.first_name || ""} ${lead.last_name || ""}`.trim(),
      phone_number,
      email: lead.email,
      size: mapSize(lead.home_size) || undefined,
      date: lead.move_date,
      origin_zip_code: lead.origin_zip,
      destination_zip_code: lead.destination_zip || undefined,
      additional_notes: [
        lead.notes,
        `Stairs@Origin: ${lead.stairs_origin || "n/a"}`,
        `Stairs@Dest: ${lead.stairs_destination || "n/a"}`,
        `Elevator@Origin: ${lead.elevator_origin ? "yes" : "no"}`,
        `Elevator@Dest: ${lead.elevator_destination ? "yes" : "no"}`,
        `Packing: ${lead.packing_needed || "n/a"}`,
        `Special: ${lead.special_items || "n/a"}`
      ].filter(Boolean).join(" | "),
      referral_source: "Web Chat",
      referral_details: `URL: ${page_url || ""}`,
      utm_content: utm.utm_content || undefined,
      utm_medium: utm.utm_medium || undefined,
      utm_source: utm.utm_source || undefined,
      utm_term: utm.utm_term || undefined,
      ad_click_id: utm.gclid || utm.fbclid || undefined,
      ad_kind: utm.gclid ? "GOOGLE_ADS" : undefined,
      is_test: !!is_test
    };

    const url = process.env.SUPERMOVE_SWI_URL;
    if (!url) {
      return Response.json({ ok: false, error: "Missing SUPERMOVE_SWI_URL" }, { status: 500, headers: corsHeaders(origin) });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (!res.ok) {
      return Response.json({ ok: false, status: res.status, error: text }, { status: 502, headers: corsHeaders(origin) });
    }

    return Response.json({ ok: true }, { headers: corsHeaders(origin) });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 400, headers: corsHeaders(origin) });
  }
}
