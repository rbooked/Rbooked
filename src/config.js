'use strict';
const path = require('path');
const fs = require('fs');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

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
  emailFrom: e.EMAIL_FROM || 'Rbooked <reservations@example.com>',
  stripe: {
    secretKey: e.STRIPE_SECRET_KEY || '',
    webhookSecret: e.STRIPE_WEBHOOK_SECRET || '',
    priceId: e.STRIPE_PRICE_ID || '',
  },
  plan: { priceCents: 2000, currency: 'usd', trialDays: 30, name: 'Rbooked for Restaurants' },
  jobIntervalSeconds: Number(e.JOB_INTERVAL_SECONDS || 300),
  isProduction: e.NODE_ENV === 'production',
};
