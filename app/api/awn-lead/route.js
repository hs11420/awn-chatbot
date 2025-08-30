// app/api/awn-lead/route.js

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

function assertAllowed(req) {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: true, origin: "" };
  if (isAllowed(origin)) return { ok: true, origin };
  return { ok: false, origin };
}

function normalizePhone(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  throw new Error("Invalid phone");
}

// Map to your exact Supermove "Project Size" labels
const SIZE_MAP = {
  "studio": "Studio",
  "1br": "1 bedroom",
  "2br": "2 bedroom",
  "3br": "3 bedroom",
  "house": "3 bedroom+"
};

function mapSize(s) {
  return SIZE_MAP[(s || "").toLowerCase()] || null;
}

// CORS preflight
export async function OPTIONS(req) {
  const { ok, origin } = assertAllowed(req);
  if (!ok) return new Response("Forbidden", { status: 403 });

  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

// Simple GET health check
export async function GET(req) {
  const { ok, origin } = assertAllowed(req);
  if (!ok) return new Response("Forbidden", { status: 403 });

  return new Response(JSON.stringify({ ok: true, route: "awn-lead" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

export async function POST(req) {
  const { ok, origin } = assertAllowed(req);
  if (!ok) return new Response("Forbidden", { status: 403 });

  const body = await req.json();
  const { lead, utm = {}, page_url, is_test = false } = body || {};

  if (!lead) {
    return new Response(JSON.stringify({ ok: false, error: "Missing lead" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  try {
    const phone_number = normalizePhone(lead.phone);

    const payload = {
      full_name: lead.full_name,
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
      return new Response(JSON.stringify({ ok: false, error: "Missing SUPERMOVE_SWI_URL" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, status: res.status, error: text }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }
}
