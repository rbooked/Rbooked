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
  platformAdmins: String(e.PLATFORM_ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
  resendApiKey: e.RESEND_API_KEY || '',
  emailFrom: e.EMAIL_FROM || 'Rbooked <reservations@example.com>',
  stripe: {
    secretKey: e.STRIPE_SECRET_KEY || '',
    webhookSecret: e.STRIPE_WEBHOOK_SECRET || '',
    priceId: e.STRIPE_PRICE_ID || '',
  },
  plan: { priceCents: 2995, currency: 'usd', trialDays: 14, name: 'Rbooked for Restaurants' },
  jobIntervalSeconds: Number(e.JOB_INTERVAL_SECONDS || 300),
  isProduction: e.NODE_ENV === 'production',
};
