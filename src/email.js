'use strict';
const config = require('./config');
const { run } = require('./db');
const { prettyDate, prettyTime, zonedToUtc } = require('./time');

// Email goes out through Resend's HTTP API (works everywhere, free tier), or SMTP on Node.js.
// With neither configured, emails are only logged ("outbox" mode).
let smtp;
function smtpTransport() {
  if (smtp !== undefined) return smtp;
  smtp = null;
  if (config.smtp.host) {
    const moduleName = 'nodemailer'; // loaded by name: Node.js only
    smtp = require(moduleName).createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return smtp;
}
async function deliver({ to, subject, html, attachments }) {
  if (config.resendApiKey) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: config.emailFrom, to: [to], subject, html,
        attachments: (attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
      }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return true;
  }
  const t = smtpTransport();
  if (!t) return false;
  await t.sendMail({ from: config.emailFrom, to, subject, html, attachments });
  return true;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(restaurant, title, bodyHtml) {
  const accent = restaurant?.accent_color || '#c2410c';
  return `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Helvetica,Arial,sans-serif;color:#1f1b16">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="background:${accent};color:#fff;padding:20px 28px;font-size:20px;font-weight:bold">${esc(restaurant?.name || 'Rbooked')}</td></tr>
    <tr><td style="padding:28px">
      <h1 style="font-size:22px;margin:0 0 16px">${esc(title)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 28px;background:#faf7f2;font-size:12px;color:#7a6f63">
      ${restaurant ? `${esc(restaurant.address)}, ${esc(restaurant.city)} ${esc(restaurant.state)} ${esc(restaurant.zip)} · ${esc(restaurant.phone)}<br>` : ''}
      Reservations powered by Rbooked
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function detailsBlock(r, res) {
  return `<table cellpadding="6" style="background:#faf7f2;border-radius:8px;width:100%;font-size:15px;margin:8px 0 18px">
    <tr><td style="color:#7a6f63;width:120px">Date</td><td><b>${esc(prettyDate(res.date))}</b></td></tr>
    <tr><td style="color:#7a6f63">Time</td><td><b>${esc(prettyTime(res.time))}</b></td></tr>
    <tr><td style="color:#7a6f63">Party</td><td><b>${res.party_size} ${res.party_size === 1 ? 'guest' : 'guests'}</b></td></tr>
    <tr><td style="color:#7a6f63">Name</td><td>${esc(res.guest_name)}</td></tr>
    <tr><td style="color:#7a6f63">Phone</td><td>${esc(res.guest_phone)}</td></tr>
    <tr><td style="color:#7a6f63">Confirmation</td><td><b>${esc(res.code)}</b></td></tr>
    ${res.notes ? `<tr><td style="color:#7a6f63">Notes</td><td>${esc(res.notes)}</td></tr>` : ''}
  </table>`;
}

const button = (href, label, color = '#c2410c') =>
  `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${esc(label)}</a>`;

const manageUrl = (res) => `${config.baseUrl}/reservation.html?t=${res.manage_token}`;

function icsFor(r, res) {
  const start = zonedToUtc(res.date, res.time, r.timezone);
  const end = new Date(start.getTime() + res.duration_minutes * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rbooked//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${res.code}@rbooked`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
    `SUMMARY:Dinner at ${r.name} (${res.party_size})`,
    `LOCATION:${[r.address, r.city, r.state, r.zip].filter(Boolean).join(', ').replace(/,/g, '\\,')}`,
    `DESCRIPTION:Confirmation ${res.code}. Manage: ${manageUrl(res)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

async function send({ to, subject, html, kind, reservationId = null, attachments }) {
  let status = 'outbox';
  let error = null;
  try {
    if (await deliver({ to, subject, html, attachments })) status = 'sent';
    else console.log(`[email:outbox] ${kind} -> ${to}: ${subject}`);
  } catch (e) {
    status = 'failed';
    error = String(e.message || e);
    console.error('[email] failed', to, subject, error);
  }
  run('INSERT INTO email_log (reservation_id, to_addr, subject, html, kind, status, error) VALUES (?,?,?,?,?,?,?)',
    reservationId, to, subject, html, kind, status, error);
  return status;
}

// ---------- Guest emails ----------
const templates = {
  confirmation(r, res) {
    return {
      subject: `Confirmed: ${r.name}, ${prettyDate(res.date)} at ${prettyTime(res.time)}`,
      html: layout(r, 'Your table is booked', `
        <p>Hi ${esc(res.guest_name.split(' ')[0])}, we look forward to seeing you.</p>
        ${detailsBlock(r, res)}
        <p style="font-size:14px;color:#7a6f63">${esc(r.cancellation_policy)}</p>
        <p>${button(manageUrl(res), 'View or cancel reservation', r.accent_color)}</p>`),
      attachments: [{ filename: 'reservation.ics', content: icsFor(r, res), contentType: 'text/calendar' }],
    };
  },
  updated(r, res) {
    return {
      subject: `Updated: ${r.name}, ${prettyDate(res.date)} at ${prettyTime(res.time)}`,
      html: layout(r, 'Your reservation was updated', `${detailsBlock(r, res)}
        <p>${button(manageUrl(res), 'View reservation', r.accent_color)}</p>`),
      attachments: [{ filename: 'reservation.ics', content: icsFor(r, res), contentType: 'text/calendar' }],
    };
  },
  reminder(r, res) {
    return {
      subject: `Reminder: ${r.name} on ${prettyDate(res.date)} at ${prettyTime(res.time)}`,
      html: layout(r, 'See you soon!', `
        <p>This is a friendly reminder of your upcoming reservation.</p>
        ${detailsBlock(r, res)}
        <p>Plans changed? Please let us know so we can offer the table to someone else.</p>
        <p>${button(manageUrl(res), 'Manage or cancel', r.accent_color)}</p>`),
    };
  },
  cancellation(r, res) {
    const byRestaurant = res.cancelled_by === 'restaurant';
    return {
      subject: `Cancelled: ${r.name}, ${prettyDate(res.date)} at ${prettyTime(res.time)}`,
      html: layout(r, 'Your reservation was cancelled', `
        <p>${byRestaurant
          ? `We're sorry, ${esc(r.name)} had to cancel your reservation. Please call us at ${esc(r.phone)} if you have questions.`
          : 'Your reservation has been cancelled. We hope to see you another time.'}</p>
        ${detailsBlock(r, res)}
        <p>${button(`${config.baseUrl}/restaurant.html?slug=${r.slug}`, 'Book again', r.accent_color)}</p>`),
    };
  },
  no_show(r, res) {
    return {
      subject: `We missed you at ${r.name}`,
      html: layout(r, 'We missed you today', `
        <p>Your reservation below was marked as a no-show. If this is a mistake, please call us at ${esc(r.phone)}.</p>
        ${detailsBlock(r, res)}
        <p>Next time, please cancel ahead so another guest can enjoy the table.</p>
        <p>${button(`${config.baseUrl}/restaurant.html?slug=${r.slug}`, 'Book a new table', r.accent_color)}</p>`),
    };
  },
  // ---------- Restaurant notifications ----------
  staff_new(r, res) {
    return {
      subject: `New reservation: ${res.guest_name}, ${res.party_size} ppl, ${prettyDate(res.date)} ${prettyTime(res.time)}`,
      html: layout(r, 'New reservation', `${detailsBlock(r, res)}
        <p>Source: ${esc(res.source)}</p><p>${button(`${config.baseUrl}/admin/`, 'Open dashboard', r.accent_color)}</p>`),
    };
  },
  staff_cancel(r, res) {
    return {
      subject: `Guest cancelled: ${res.guest_name}, ${prettyDate(res.date)} ${prettyTime(res.time)}`,
      html: layout(r, 'A guest cancelled', `${detailsBlock(r, res)}
        <p>${button(`${config.baseUrl}/admin/`, 'Open dashboard', r.accent_color)}</p>`),
    };
  },
};

async function sendReservationEmail(kind, restaurant, res) {
  const t = templates[kind](restaurant, res);
  const staff = kind.startsWith('staff_');
  const to = staff ? restaurant.email : res.guest_email;
  if (!to) return null;
  return send({ to, subject: t.subject, html: t.html, attachments: t.attachments, kind, reservationId: res.id });
}

async function sendWelcome(restaurant, user) {
  return send({
    to: user.email,
    kind: 'welcome',
    subject: `Welcome to Rbooked, ${restaurant.name}!`,
    html: layout(null, 'Your 14-day free trial has started', `
      <p>Hi ${esc(user.name)}, thanks for joining Rbooked.</p>
      <p>Your free trial runs until <b>${esc(new Date(restaurant.trial_ends_at).toDateString())}</b>.
      After that it's just <b>$49/month</b>, cancel anytime.</p>
      <p>Next steps: add your tables, set your services, and paste the booking widget on your website.</p>
      <p>${button(`${config.baseUrl}/admin/`, 'Open your dashboard')}</p>`),
  });
}

async function sendTrialEnding(restaurant, to, daysLeft) {
  return send({
    to, kind: 'trial_ending',
    subject: `Your Rbooked trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    html: layout(null, 'Keep taking reservations', `
      <p>Your free trial for <b>${esc(restaurant.name)}</b> ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.
      Add a payment method to keep your restaurant bookable for $49/month.</p>
      <p>${button(`${config.baseUrl}/admin/#billing`, 'Add payment method')}</p>`),
  });
}

module.exports = { sendReservationEmail, sendWelcome, sendTrialEnding, send, esc };
