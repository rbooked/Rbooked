'use strict';
// SMTP isn't available on Cloudflare Workers; email goes through Resend's HTTP API instead (RESEND_API_KEY).
module.exports = {
  createTransport() {
    return { sendMail: async () => { throw new Error('SMTP is not supported on Cloudflare. Set RESEND_API_KEY.'); } };
  },
};
