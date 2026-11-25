'use strict';
const config = require('./config');
const { one, run } = require('./db');

// Stripe client, created on first use. The fetch-based HTTP client works on Node.js and Cloudflare alike.
let client;
function stripe() {
  if (client === undefined) {
    client = null;
    if (config.stripe.secretKey) {
      const Stripe = require('stripe');
      client = Stripe(config.stripe.secretKey, { httpClient: Stripe.createFetchHttpClient() });
    }
  }
  return client;
}

/** A restaurant shows up in search and accepts bookings while trialing or paid. */
function isBookable(r) {
  if (!r) return false;
  if (r.subscription_status === 'active' || r.subscription_status === 'past_due') return true;
  if (r.subscription_status === 'trialing') return new Date(r.trial_ends_at) > new Date();
  return false;
}

function billingSummary(r) {
  const trialMsLeft = new Date(r.trial_ends_at) - new Date();
  const status = r.subscription_status === 'trialing' && trialMsLeft <= 0 ? 'expired' : r.subscription_status;
  return {
    status,
    bookable: isBookable(r),
    trialEndsAt: r.trial_ends_at,
    trialDaysLeft: Math.max(0, Math.ceil(trialMsLeft / 86400000)),
    hasPaymentMethod: !!r.stripe_subscription_id,
    price: '$20/month',
    stripeEnabled: !!stripe(),
    demoMode: !stripe(),
  };
}

async function createCheckout(r, user) {
  if (!stripe()) throw new Error('Stripe is not configured (demo mode).');
  let customerId = r.stripe_customer_id;
  if (!customerId) {
    const c = await stripe().customers.create({ email: user.email, name: r.name, metadata: { restaurant_id: String(r.id) } });
    customerId = c.id;
    run('UPDATE restaurants SET stripe_customer_id = ? WHERE id = ?', customerId, r.id);
  }
  const lineItem = config.stripe.priceId
    ? { price: config.stripe.priceId, quantity: 1 }
    : {
      quantity: 1,
      price_data: {
        currency: config.plan.currency, unit_amount: config.plan.priceCents,
        recurring: { interval: 'month' }, product_data: { name: config.plan.name },
      },
    };
  const subscription_data = { metadata: { restaurant_id: String(r.id) } };
  // Keep whatever is left of the 30-day trial (Stripe requires trial_end >= 48h ahead).
  const trialEnd = Math.floor(new Date(r.trial_ends_at).getTime() / 1000);
  if (trialEnd > Date.now() / 1000 + 48 * 3600) subscription_data.trial_end = trialEnd;

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [lineItem],
    subscription_data,
    payment_method_collection: 'always',
    client_reference_id: String(r.id),
    success_url: `${config.baseUrl}/admin/#billing?checkout=success`,
    cancel_url: `${config.baseUrl}/admin/#billing?checkout=cancel`,
  });
  return session.url;
}

async function createPortal(r) {
  if (!stripe() || !r.stripe_customer_id) throw new Error('No billing account yet.');
  const s = await stripe().billingPortal.sessions.create({ customer: r.stripe_customer_id, return_url: `${config.baseUrl}/admin/#billing` });
  return s.url;
}

function applySubscription(sub) {
  const rid = Number(sub.metadata && sub.metadata.restaurant_id)
    || (one('SELECT id FROM restaurants WHERE stripe_customer_id = ?', sub.customer) || {}).id;
  if (!rid) return;
  const map = { trialing: 'active', active: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'canceled', incomplete_expired: 'canceled' };
  // A Stripe "trialing" subscription already has a card on file, so treat as active.
  const status = map[sub.status] || 'past_due';
  run('UPDATE restaurants SET subscription_status = ?, stripe_subscription_id = ?, stripe_customer_id = ? WHERE id = ?',
    status, sub.id, sub.customer, rid);
}

/** Express handler; must be mounted with express.raw(). */
async function webhook(req, res) {
  if (!stripe()) return res.status(400).send('Stripe not configured');
  if (!config.stripe.webhookSecret && config.isProduction) return res.status(400).send('STRIPE_WEBHOOK_SECRET is required');
  let event;
  try {
    event = config.stripe.webhookSecret
      ? await stripe().webhooks.constructEventAsync(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret, undefined, require('stripe').createSubtleCryptoProvider())
      : JSON.parse(req.body.toString());
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.subscription) applySubscription(await stripe().subscriptions.retrieve(s.subscription));
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        applySubscription(event.data.object);
        break;
      default:
        break;
    }
  } catch (e) {
    console.error('[stripe webhook]', e);
    return res.status(500).send('error');
  }
  res.json({ received: true });
}

module.exports = { isBookable, billingSummary, createCheckout, createPortal, webhook, stripe };
