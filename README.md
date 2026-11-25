# Rbooked: restaurant reservations

Rbooked is a full restaurant reservation platform made of five parts:

- **Diner website.** Guests search by **ZIP code** and see nearby restaurants with their open times. They book with name, email and phone, then change or cancel from a private link.
- **Restaurant dashboard.** Restaurants manage reservations, tables, seats and chairs, the floor plan, services (shifts), closed dates, guests, no-shows and settings.
- **Embeddable widget.** Restaurants add booking to their own website with one line of code, either as an inline form or a floating "Reserve" button.
- **Emails.** Confirmations come with a calendar invite. There are also reminders, change notices, cancellations and no-show follow-ups, and staff are alerted about new bookings and cancellations.
- **Subscriptions.** Each restaurant gets **30 days free, then $20/month** through Stripe Checkout and the Billing Portal.

Stack: Node.js 22, Express, SQLite (the built-in `node:sqlite`, so there is nothing native to compile), Nodemailer and Stripe. The frontend is plain HTML, CSS and JS with no build step.

---

## Quick start (local)

```bash
npm install
cp .env.example .env        # edit SESSION_SECRET at minimum
npm run seed                # demo restaurants + sample bookings
npm start                   # http://localhost:3000
```

- Diner site: http://localhost:3000 (try ZIPs **10011**, **94110**, **97205**, **60607**, **78701**)
- Restaurant login: http://localhost:3000/login with **demo@rbooked.test / demo1234**
- Sign up a new restaurant: http://localhost:3000/for-restaurants
- Email outbox (dev only, when SMTP isn't configured): http://localhost:3000/dev/outbox
- Tests: `npm test`

Requires **Node 22.13+** (for `node:sqlite` and `process.loadEnvFile`).

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `BASE_URL` | Public URL, e.g. `https://book.yourdomain.com`. Used in emails and widget code. |
| `SESSION_SECRET` | Long random string (`openssl rand -hex 32`) |
| `DATABASE_PATH` | SQLite file path (default `./data/rbooked.db`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Any SMTP provider (Postmark, SendGrid, Mailgun, Amazon SES, Gmail…). Leave `SMTP_HOST` empty for outbox mode. |
| `EMAIL_FROM` | e.g. `Rbooked <reservations@yourdomain.com>` |
| `STRIPE_SECRET_KEY` | `sk_test_…` first, `sk_live_…` when you launch. Empty = demo billing mode. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from your Stripe webhook endpoint (required in production) |
| `STRIPE_PRICE_ID` | Optional. A recurring $20/month Price. If empty, the price is created inline at checkout. |
| `JOB_INTERVAL_SECONDS` | How often reminders and no-show jobs run (default 300) |
| `NODE_ENV` | Set to `production` in production. This turns off `/dev/outbox`, the demo hint and demo billing. |

### Email setup
1. Pick an SMTP provider and verify your sending domain (add the SPF and DKIM records they give you).
2. Fill in the `SMTP_*` values and `EMAIL_FROM`.
3. Restart. Every email sent is also recorded in each restaurant's **Email log** page in the dashboard.

### Stripe setup (test mode first)
1. In the Stripe Dashboard (test mode), copy your **secret key** into `STRIPE_SECRET_KEY`.
2. Optionally create a Product "Rbooked for Restaurants" with a **$20.00 USD monthly** price and put its id in `STRIPE_PRICE_ID`.
3. Add a webhook endpoint at `https://YOUR_DOMAIN/api/stripe/webhook` for these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
   For local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
4. In **Settings → Billing → Customer portal**, enable cancel and update payment method.
5. Test with card `4242 4242 4242 4242`. When you go live, swap to live keys and a live webhook.

How billing works:
- Signup creates the restaurant in `trialing` status with `trial_ends_at` = now + 30 days. No card is required.
- "Add payment method" opens Stripe Checkout for a $20/month subscription. The remaining trial carries over (`trial_end`), so the first charge happens when the 30 days are up.
- Webhooks keep `subscription_status` in sync: `active`, `past_due` or `canceled`.
- If the trial ends without a subscription, or the subscription is cancelled, the restaurant is **hidden from search and the widget stops taking bookings**. All data is kept, and subscribing turns everything back on.
- Owners get "trial ending" emails 7 days and 1 day before the trial ends.

## Features in detail

**Diners**
- ZIP code search within 25 miles, sorted by distance. ZIP codes are looked up through the free zippopotam.us API and cached in SQLite. If that lookup fails, results fall back to matching the first 3 digits of the ZIP.
- Each result shows the 5 open times closest to the time the guest asked for.
- The restaurant page shows every service (lunch, dinner, brunch) with live availability.
- Booking takes name, email, phone, occasion and special requests. A hidden honeypot field blocks simple bots.
- The private manage link lets guests view, **change** (date, time or party size, re-checked against availability) or **cancel**.

- **Pick for me**: diners choose a few quick options (food such as vegan or halal, vibe such as classy or romantic, extras, price) plus a time. Rbooked ranks nearby restaurants with a table open within 90 minutes of that time and shows a top pick with a match score, the reasons, and other good matches. Food choices are treated as must-haves. The ranking lives in `public/js/matcher.js`.
- **Featured restaurants** appear on the home page, near the diner's ZIP when one is known. Featured is set by the platform (`restaurants.featured`), so it can later become a paid add-on.

**Restaurants (dashboard at `/admin/`)**
- **Reservations**: a live day view (refreshes every 30 seconds, with an "Up next" strip of arrivals) with list and **timeline** (tables × time) modes. On the timeline, drag a booking to another table or time to move it (15-minute snap). Also plus stats for covers, seated, no-shows and cancellations. Staff can seat, complete, mark no-show, cancel (with optional guest email), edit, reassign tables, resend email, take phone bookings and seat walk-ins. Each guest shows history tags (visits and no-shows) and a "Late" flag.
- **Floor plan & tables**: rooms or areas; drag-and-drop tables; shapes (square, round, long, booth, bar); **min and max seats with chairs drawn around each table**; rotation; online-bookable and active flags. A live view shows which tables are booked or seated at any time.
- **Services & hours**: per service, set the days, first and last seating, slot interval, table turn time, and **max covers per slot** (pacing). Closed dates and holidays can be added too.
- **Floor plan view of the book**: Reservations opens on a live floor plan. Each table is colored by what's happening (free, arriving within 30 minutes, booked, seated) and shows who's there until when, or who's next. Slide through the night or follow "Now". Tap a table to see its current party, the next reservation and how long until it, the rest of its night and which combinations it belongs to, then seat, edit, book that table or seat a walk-in there.
- **Reservation length by party size** (Services & hours): for example 1-2 guests 1.5 hours, 3-4 guests 2 hours, 5-6 guests 3 hours. Availability, online booking, staff bookings and walk-ins all hold tables for that long. Turn it off to use each service's turn time.
- **Table combinations**: tap tables on the Reservations floor plan (or use Floor plan & tables) to join two or more tables (for example T4 + T5) into one seating with its own min and max seats and online-bookable flag. A combination blocks every table in it, and appears in the table pickers on reservations.
- **Address book**: every guest who books is added automatically (matched by email, then phone). Staff can add contacts by hand and keep tags (VIP, Allergy, Regular…), notes, birthday and marketing opt-in. Each contact shows visits, no-shows, cancellations, the next booking and full history, and staff can book them in one tap. Tags and notes show on the guest's reservations.
- **Website widget**: copy-paste snippets (inline, floating button, iframe, direct link) with a live preview.
- **Settings**: profile, tags that describe the restaurant (vegan, classy, outdoor seating…), brand color, max online party size, booking window, minimum notice, reminder timing, cancellation policy, and no-show automation (grace period and whether to email the guest).
- **Billing** and the **Email log**.

**How availability works**
For each active service on that weekday, slots run from the first to the last seating at the service's interval. A slot is open if all three of these hold:
1. It is inside the booking window and respects the minimum notice.
2. The service's covers-per-slot limit isn't exceeded.
3. An active, online-bookable table (or table combination) with `min_seats ≤ party ≤ max_seats` has no overlapping booking during the turn time.

The smallest single table that fits is assigned. Tables are only joined when no single table works. Bookings are re-checked inside a database transaction, so two guests can't take the same table.

**Background jobs** (every `JOB_INTERVAL_SECONDS`)
- Reminder emails go out N hours before the booking (set per restaurant, default 24).
- Optional auto no-show marks unseated guests after a grace period, with an optional email.
- Seated parties are closed out as completed after their turn time.
- Trial-ending notices go to owners.

## Embedding the widget

```html
<!-- Inline booking form -->
<div data-rbooked="your-restaurant-slug"></div>
<script src="https://YOUR_DOMAIN/widget.js" async></script>

<!-- Floating "Reserve a table" button -->
<script src="https://YOUR_DOMAIN/widget.js" data-restaurant="your-restaurant-slug" data-mode="button" data-color="#c2410c" async></script>
```

The widget is an auto-resizing iframe, so it never conflicts with the host site's CSS. Host pages can listen for `document.addEventListener('rbooked:booked', e => …)` (for example, to fire analytics).

## Deploying

Any host that runs Node 22 and gives you a **persistent disk** for the SQLite file works: Render, Railway, Fly.io, a DigitalOcean droplet, and so on.

**Docker**
```bash
docker build -t rbooked .
docker run -d -p 3000:3000 -v rbooked-data:/data --env-file .env rbooked
docker exec -it <container> node src/seed.js   # optional demo data
```

**Render / Railway**: create a Web Service from this folder with build command `npm ci` and start command `npm start`. Attach a disk mounted at `/data` and set `DATABASE_PATH=/data/rbooked.db`, `NODE_ENV=production`, `BASE_URL` and the email and Stripe variables.

Put it behind HTTPS (the platforms above do this for you); session cookies are marked `Secure` when `BASE_URL` starts with `https`. Back up the SQLite file regularly, for example with a nightly copy or Litestream. To grow past one server, switch `src/db.js` to Postgres; all SQL lives in the `src/` modules.

## Project layout

```
src/
  server.js          Express app, static files, webhook, dev outbox
  config.js          .env loading
  db.js              SQLite schema
  availability.js    slot / table assignment engine
  reservations.js    create / cancel / no-show logic
  email.js           templates (+ .ics invites) and sending
  billing.js         Stripe checkout, portal, webhook, trial logic
  jobs.js            reminders, auto no-show, trial notices
  geo.js             ZIP lookup + distance
  seed.js            demo data
  routes/public.js   search, availability, booking, manage-reservation API
  routes/auth.js     restaurant signup / login
  routes/admin.js    dashboard API
public/
  index.html         ZIP search
  restaurant.html    restaurant page + booking
  reservation.html   guest manage / cancel / change
  for-restaurants.html  pricing + signup
  login.html
  admin/             dashboard SPA
  embed.html, widget.js  embeddable widget
test/api.test.js     end-to-end API tests (npm test)
```

## Before you launch
- Set `NODE_ENV=production`, a strong `SESSION_SECRET`, a real `BASE_URL`, SMTP and live Stripe keys.
- Don't run `npm run seed` in production, or delete the demo restaurants afterwards.
- Add your own Terms of Service and Privacy Policy pages, since you're storing guest names, emails and phone numbers.
- Optional next steps: SMS reminders (e.g. Twilio), password reset emails, multiple staff logins per restaurant, waitlist, deposits and cards on file for no-show fees (Stripe SetupIntents), and Google Reserve integration.
