'use strict';
// Load a local .env file when running under Node.js (on Cloudflare, settings come from the dashboard).
try {
  const envFile = require('path').join(__dirname, '..', '.env');
  if (typeof process.loadEnvFile === 'function' && require('fs').existsSync(envFile)) process.loadEnvFile(envFile);
} catch { /* not on Node.js */ }

const e = process.env;
module.exports = {
  port: Number(e.PORT || 3000),
  baseUrl: (e.BASE_URL || `http://localhost:${e.PORT || 3000}`).replace(/\/$/, ''),
  sessionSecret: e.SESSION_SECRET || 'dev-secret',
  databasePath: e.DATABASE_PATH || './data/rbooked.db',
  smtp: {
    host: e.SMTP_HOST || '',
    port: Number(e.SMTP_PORT || 587),
    secure: String(e.SMTP_SECURE) === 'true',
    user: e.SMTP_USER || '',
    pass: e.SMTP_PASS || '',
  },
  // Rbooked staff who can feature restaurants (comma-separated emails; set in Cloudflare, not in the repo).
  platformAdmins: [], // no longer used: featuring restaurants is on the support page (/staff.html)
  resendApiKey: e.RESEND_API_KEY || '',
  // Mail goes out from the verified rbooked.com domain. A personal address (like Gmail) set as EMAIL_FROM can't
  // be sent from, so it becomes the Reply-To instead: replies still reach that inbox.
  ...(() => {
    const from = e.EMAIL_FROM || 'Rbooked <reservations@rbooked.com>';
    const personal = /@(gmail|googlemail|yahoo|outlook|hotmail|icloud|aol)\./i.test(from);
    const addr = (/<([^>]+)>/.exec(from) || [null, from])[1].trim();
    return { emailFrom: personal ? 'Rbooked <reservations@rbooked.com>' : from, replyTo: e.EMAIL_REPLY_TO || (personal ? addr : '') };
  })(),
  stripe: {
    secretKey: e.STRIPE_SECRET_KEY || '',
    webhookSecret: e.STRIPE_WEBHOOK_SECRET || '',
    priceId: e.STRIPE_PRICE_ID || '',
  },
  plan: { priceCents: 4900, currency: 'usd', trialDays: 14, name: 'Rbooked for Restaurants' },
  jobIntervalSeconds: Number(e.JOB_INTERVAL_SECONDS || 300),
  isProduction: e.NODE_ENV === 'production',
  supportEmail: (e.SUPPORT_EMAIL || 'rbookedsupport@gmail.com').trim(),
};
