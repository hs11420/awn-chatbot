// app/api/awn-lead/route.js
import { NextResponse } from 'next/server';
import { Resend } from 'resend';

// Build the Resend client (throws if key missing)
const resend = new Resend(process.env.RESEND_API_KEY);

// helpers
function safe(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export async function POST(req) {
  try {
    const body = await req.json(); // { lead, utm, page_url, ... }
    const lead = body?.lead || body || {};

    // ---- Configure recipients/sender from env ----
    // During testing you can set:
    //   LEAD_FROM="AW Movers <onboarding@resend.dev>"
    // and change later to a verified domain sender.
    const to   = process.env.LEAD_TO   || 'moves@awnationwide.com';
    const from = process.env.LEAD_FROM || 'AW Nationwide <onboarding@resend.dev>';

    const subject = `New chat lead – ${lead.name || `${lead.first_name || ''} ${lead.last_name || ''}` || 'Unknown'}`.trim();

    // Plain-text fallback
    const text = [
      `New lead from website chat`,
      ``,
      `Name: ${lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || ''}`,
      `Phone: ${lead.phone || ''}`,
      `Email: ${lead.email || ''}`,
      ``,
      `Service: ${lead.service || ''}`,
      `Move date: ${lead.move_date || ''}`,
      `From ZIP: ${lead.from_zip || ''}`,
      `To ZIP: ${lead.to_zip || ''}`,
      `Bedrooms: ${lead.bedrooms || ''}`,
      `Home type: ${lead.home_type || ''}`,
      `Stairs/Elevator: ${lead.stairs || ''}`,
      `Packing: ${lead.packing || ''}`,
      `Heavy/Special: ${Array.isArray(lead.special_items) ? lead.special_items.join(', ') : safe(lead.special_items)}`,
      `Financing interest: ${lead.financing_interest ? 'Yes' : 'No'}`,
      `Promo/Referral: ${lead.promo_code || ''}`,
      ``,
      `Page URL: ${body.page_url || ''}`,
      `UTM: ${safe(body.utm)}`
    ].join('\n');

    // Simple HTML summary
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.4">
        <h2>New chat lead</h2>
        <table cellpadding="6" style="border-collapse:collapse">
          <tr><td><b>Name</b></td><td>${safe(lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(' '))}</td></tr>
          <tr><td><b>Phone</b></td><td>${safe(lead.phone)}</td></tr>
          <tr><td><b>Email</b></td><td>${safe(lead.email)}</td></tr>
          <tr><td><b>Service</b></td><td>${safe(lead.service)}</td></tr>
          <tr><td><b>Move date</b></td><td>${safe(lead.move_date)}</td></tr>
          <tr><td><b>From ZIP</b></td><td>${safe(lead.from_zip)}</td></tr>
          <tr><td><b>To ZIP</b></td><td>${safe(lead.to_zip)}</td></tr>
          <tr><td><b>Bedrooms</b></td><td>${safe(lead.bedrooms)}</td></tr>
          <tr><td><b>Home type</b></td><td>${safe(lead.home_type)}</td></tr>
          <tr><td><b>Stairs/Elevator</b></td><td>${safe(lead.stairs)}</td></tr>
          <tr><td><b>Packing</b></td><td>${safe(lead.packing)}</td></tr>
          <tr><td><b>Heavy / Special items</b></td><td>${Array.isArray(lead.special_items) ? lead.special_items.join(', ') : safe(lead.special_items)}</td></tr>
          <tr><td><b>Financing interest</b></td><td>${lead.financing_interest ? 'Yes' : 'No'}</td></tr>
          <tr><td><b>Promo / Referral</b></td><td>${safe(lead.promo_code)}</td></tr>
        </table>
        <p><b>Page URL:</b> ${safe(body.page_url)}</p>
        <p><b>UTM:</b> <code>${safe(body.utm)}</code></p>
      </div>
    `;

    await resend.emails.send({ to, from, subject, text, html });

    // (Optional) also post to Supermove webhook if you have it:
    // if (process.env.SUPERMOVE_WEBHOOK_URL) {
    //   await fetch(process.env.SUPERMOVE_WEBHOOK_URL, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify(body),
    //   });
    // }

    return NextResponse.json({ ok: true, emailed: true });
  } catch (err) {
    console.error('awn-lead email error:', err);
    return NextResponse.json({ ok: false, error: 'email_failed' }, { status: 500 });
  }
}
