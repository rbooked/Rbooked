/* Tablebird restaurant dashboard (vanilla JS single-page app). */
(function () {
  const { api, esc } = TB;
  const view = document.getElementById('view');
  const S = { me: null, date: null, mode: 'list', floorArea: null, selTable: null };
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const STATUS_LABEL = { confirmed: 'Booked', seated: 'Seated', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' };
  const SOURCE_LABEL = { online: 'Tablebird', widget: 'Website', phone: 'Phone', walk_in: 'Walk-in', admin: 'Staff' };

  const fail = (e) => TB.toast(e.message, true);
  const nowLocal = () => {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: S.me.restaurant.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date()).map((x) => [x.type, x.value]));
      return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
    } catch { return { date: TB.today(), minutes: 0 }; }
  };
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  // ---------------- Boot ----------------
  async function boot() {
    try {
      S.me = await api('/api/admin/restaurant');
    } catch (e) {
      if (e.status === 401) { location.href = '/login'; return; }
      view.innerHTML = `<div class="alert error">${esc(e.message)}</div>`; return;
    }
    const r = S.me.restaurant;
    document.getElementById('rest-name').textContent = r.name;
    document.getElementById('user-name').textContent = S.me.user.name;
    document.getElementById('public-link').href = `/restaurant?slug=${r.slug}`;
    if (r.accent_color) document.documentElement.style.setProperty('--brand', r.accent_color);
    S.date = nowLocal().date;
    renderBanner();
    document.getElementById('logout').onclick = async () => { await api('/api/auth/logout', { body: {} }); location.href = '/login'; };
    document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
    window.addEventListener('hashchange', route);
    route();
  }

  function renderBanner() {
    const b = S.me.billing;
    const el = document.getElementById('banner');
    if (b.status === 'expired' || b.status === 'canceled') {
      el.innerHTML = `<div class="alert error"><b>Your restaurant is hidden from search and the widget is paused.</b> ${b.status === 'expired' ? 'Your free trial has ended.' : 'Your subscription was cancelled.'} <a href="#billing">Subscribe for $20/month</a> to start taking reservations again.</div>`;
    } else if (b.status === 'trialing') {
      el.innerHTML = `<div class="alert">Free trial: <b>${b.trialDaysLeft} day${b.trialDaysLeft === 1 ? '' : 's'} left</b>. <a href="#billing">Add a payment method</a> to keep bookings flowing after your trial ($20/month).</div>`;
    } else if (b.status === 'past_due') {
      el.innerHTML = '<div class="alert error">Your last payment failed. <a href="#billing">Update your card</a> to avoid interruption.</div>';
    } else el.innerHTML = '';
  }

  const VIEWS = {
    reservations: ['Reservations', viewReservations], floor: ['Floor plan & tables', viewFloor], services: ['Services & hours', viewServices],
    guests: ['Guests', viewGuests], widget: ['Website widget', viewWidget], settings: ['Settings', viewSettings],
    billing: ['Billing', viewBilling], emails: ['Email log', viewEmails], welcome: ['Welcome', viewWelcome],
  };
  function route() {
    const key = (location.hash.slice(1).split('?')[0]) || 'reservations';
    const [title, fn] = VIEWS[key] || VIEWS.reservations;
    document.getElementById('view-title').textContent = title;
    document.querySelectorAll('#side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === key));
    document.getElementById('sidebar').classList.remove('open');
    view.innerHTML = '<p class="muted">Loading…</p>';
    fn().catch(fail);
  }

  // ---------------- Welcome (after signup) ----------------
  async function viewWelcome() {
    const r = S.me.restaurant;
    view.innerHTML = `<div class="card" style="max-width:720px">
      <h2 class="serif" style="font-size:26px">Welcome to Tablebird, ${esc(r.name)}! 🎉</h2>
      <p>Your 30-day free trial is running and you're already live in ZIP code search with a starter setup. Finish these steps:</p>
      <ol style="line-height:2.1">
        <li><a href="#floor">Set up your floor plan</a>: rooms, tables, and seats per table.</li>
        <li><a href="#services">Set your services</a>: lunch, dinner, brunch, seating times and turn times.</li>
        <li><a href="#settings">Review booking rules</a>: max party size, reminders, no-show policy.</li>
        <li><a href="#widget">Add the booking widget</a> to your website.</li>
        <li><a href="#billing">Add a payment method</a> so you stay live after the trial ($20/month).</li>
      </ol>
      <a class="btn" href="#reservations">Go to reservations</a></div>`;
  }

  // ---------------- Reservations ----------------
  async function viewReservations() {
    view.innerHTML = `
      <div class="toolbar">
        <button class="btn secondary sm" id="d-prev" aria-label="Previous day">‹</button>
        <input type="date" id="d-date" value="${S.date}">
        <button class="btn secondary sm" id="d-next" aria-label="Next day">›</button>
        <button class="btn secondary sm" id="d-today">Today</button>
        <div class="seg" role="tablist"><button data-mode="list">List</button><button data-mode="timeline">Timeline</button></div>
        <input type="search" id="d-q" placeholder="Search name, phone, code">
        <span class="spacer"></span>
        <button class="btn secondary" id="walkin">+ Walk-in</button>
        <button class="btn" id="newres">+ New reservation</button>
      </div>
      <div class="stats" id="stats"></div>
      <div id="res-body"></div>`;
    const setDate = (d) => { S.date = d; document.getElementById('d-date').value = d; load(); };
    document.getElementById('d-prev').onclick = () => setDate(TB.addDays(S.date, -1));
    document.getElementById('d-next').onclick = () => setDate(TB.addDays(S.date, 1));
    document.getElementById('d-today').onclick = () => setDate(nowLocal().date);
    document.getElementById('d-date').onchange = (e) => setDate(e.target.value);
    document.getElementById('d-q').oninput = () => load();
    document.querySelectorAll('.seg button').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === S.mode);
      b.onclick = () => { S.mode = b.dataset.mode; document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b)); load(); };
    });
    document.getElementById('newres').onclick = () => reservationModal(null, load);
    document.getElementById('walkin').onclick = () => walkInModal(load);
    await load();
  }

  async function load() {
    const q = (document.getElementById('d-q') || {}).value || '';
    const [data, stats, floor] = await Promise.all([
      api(`/api/admin/reservations?date=${S.date}&q=${encodeURIComponent(q)}`),
      api(`/api/admin/stats?date=${S.date}`),
      api('/api/admin/floor'),
    ]);
    S.floor = floor;
    document.getElementById('stats').innerHTML = [
      ['Reservations', data.reservations.filter((x) => !['cancelled'].includes(x.status)).length],
      ['Covers', stats.covers || 0], ['Upcoming', stats.upcoming || 0], ['Seated', stats.seated || 0],
      ['Completed', stats.completed || 0], ['No-shows', stats.no_shows || 0], ['Cancelled', stats.cancelled || 0],
      ['Seats', `${stats.seats}`],
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    const body = document.getElementById('res-body');
    if (S.mode === 'timeline') return renderTimeline(body, data.reservations, floor);
    renderList(body, data.reservations, floor);
  }

  function guestTags(x) {
    const h = x.history || {};
    const tags = [];
    if (x.source) tags.push(`<span class="tag">${SOURCE_LABEL[x.source] || x.source}</span>`);
    if (x.occasion) tags.push(`<span class="tag good">${esc(x.occasion)}</span>`);
    if (h.visits > 0) tags.push(`<span class="tag good">${h.visits} visit${h.visits > 1 ? 's' : ''}</span>`);
    if (h.no_shows > 0) tags.push(`<span class="tag warn">${h.no_shows} no-show${h.no_shows > 1 ? 's' : ''}</span>`);
    return `<div class="guest-tags">${tags.join('')}</div>`;
  }

  function renderList(body, rows, floor) {
    if (!rows.length) { body.innerHTML = `<div class="card"><p class="muted" style="margin:0">No reservations for ${TB.date(S.date, { weekday: 'long', month: 'long' })}.</p></div>`; return; }
    const now = nowLocal();
    const tableOpts = (sel) => `<option value="">Unassigned</option>${floor.tables.filter((t) => t.active).map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.label)} (${t.min_seats}-${t.max_seats})</option>`).join('')}`;
    body.innerHTML = `<div class="card" style="padding:0"><div class="table-wrap"><table class="data">
      <thead><tr><th>Time</th><th>Guest</th><th>Party</th><th>Table</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows.map((x) => {
        const late = x.status === 'confirmed' && x.date === now.date && toMin(x.time) + 15 < now.minutes;
        const dim = ['cancelled', 'no_show', 'completed'].includes(x.status);
        return `<tr class="${dim ? 'dim' : ''}" data-id="${x.id}">
          <td class="time-cell">${TB.time(x.time)}${late ? '<br><span class="tag warn">Late</span>' : ''}</td>
          <td><b>${esc(x.guest_name)}</b><br><a href="tel:${esc(x.guest_phone)}">${esc(x.guest_phone)}</a> · <span class="muted">${esc(x.guest_email)}</span>
            ${guestTags(x)}${x.notes ? `<div class="small" style="margin-top:4px">📝 ${esc(x.notes)}</div>` : ''}${x.internal_notes ? `<div class="small muted">🔒 ${esc(x.internal_notes)}</div>` : ''}
            <div class="small muted">#${esc(x.code)}</div></td>
          <td>${x.party_size}</td>
          <td><select data-act="table" ${dim ? 'disabled' : ''} style="min-width:120px">${tableOpts(x.table_id)}</select></td>
          <td><span class="badge ${x.status}">${STATUS_LABEL[x.status]}</span></td>
          <td><div class="res-actions">
            ${x.status === 'confirmed' ? '<button class="btn ok sm" data-act="seat">Seat</button><button class="btn secondary sm" data-act="noshow">No-show</button>' : ''}
            ${x.status === 'seated' ? '<button class="btn secondary sm" data-act="complete">Complete</button>' : ''}
            ${['confirmed', 'seated'].includes(x.status) ? '<button class="btn secondary sm" data-act="edit">Edit</button><button class="btn secondary sm" data-act="cancel">Cancel</button>' : ''}
            ${['no_show', 'completed'].includes(x.status) ? '<button class="btn secondary sm" data-act="undo">Undo</button>' : ''}
            ${x.guest_email !== 'walkin@guest.local' ? '<button class="btn ghost sm" data-act="resend" title="Resend email">✉️</button>' : ''}
          </div></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const x = rows.find((r) => r.id === Number(tr.dataset.id));
      tr.querySelectorAll('[data-act]').forEach((el) => {
        const act = el.dataset.act;
        if (act === 'table') {
          el.onchange = () => api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { table_id: el.value ? Number(el.value) : null } })
            .then(() => { TB.toast('Table updated'); load(); })
            .catch((e) => { if (e.status === 409 && confirm(`${e.message} Assign anyway?`)) api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { table_id: Number(el.value), force: true } }).then(load); else { fail(e); load(); } });
        } else el.onclick = () => resAction(act, x);
      });
    });
  }

  async function resAction(act, x) {
    try {
      if (act === 'seat') await api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { status: 'seated' } });
      if (act === 'complete') await api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { status: 'completed' } });
      if (act === 'undo') await api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { status: 'confirmed' } });
      if (act === 'resend') { await api(`/api/admin/reservations/${x.id}/resend`, { body: {} }); TB.toast('Email sent'); return; }
      if (act === 'edit') return reservationModal(x, load);
      if (act === 'noshow' || act === 'cancel') {
        const isNo = act === 'noshow';
        return TB.modal(`<h2>${isNo ? 'Mark as no-show?' : 'Cancel reservation?'}</h2>
          <p>${esc(x.guest_name)}, ${x.party_size} guests at ${TB.time(x.time)}.</p>
          <label class="check"><input type="checkbox" id="m-notify" ${isNo && !S.me.restaurant.send_no_show_email ? '' : 'checked'}> Email the guest</label>
          <div class="row" style="margin-top:16px"><button class="btn danger" id="m-yes">${isNo ? 'Mark no-show' : 'Cancel reservation'}</button><button class="btn secondary" data-close>Back</button></div>`,
        (m, close) => {
          m.querySelector('#m-yes').onclick = async () => {
            try {
              await api(`/api/admin/reservations/${x.id}/${isNo ? 'no-show' : 'cancel'}`, { body: { notify: m.querySelector('#m-notify').checked } });
              close(); TB.toast(isNo ? 'Marked as no-show' : 'Reservation cancelled'); load();
            } catch (e) { fail(e); }
          };
        });
      }
      load();
    } catch (e) { fail(e); }
  }

  function renderTimeline(body, rows, floor) {
    const active = rows.filter((x) => ['confirmed', 'seated', 'completed'].includes(x.status));
    let start = 10 * 60; let end = 23 * 60;
    active.forEach((x) => { start = Math.min(start, Math.floor(toMin(x.time) / 60) * 60); end = Math.max(end, toMin(x.time) + x.duration_minutes); });
    const span = end - start;
    const pct = (m) => `${((m - start) / span) * 100}%`;
    const tables = floor.tables.filter((t) => t.active);
    const unassigned = active.filter((x) => !x.table_id);
    const now = nowLocal();
    const nowLine = now.date === S.date && now.minutes > start && now.minutes < end ? `<div class="tl-now" style="left:${pct(now.minutes)}"></div>` : '';
    const lines = []; for (let m = start; m <= end; m += 60) lines.push(m);
    const row = (label, sub, items) => `<div class="tl-row"><div class="tl-label">${esc(label)}<small>${sub}</small></div><div class="tl-track">
      ${lines.map((m) => `<div class="tl-line" style="left:${pct(m)}"></div>`).join('')}${nowLine}
      ${items.map((x) => `<div class="tl-bar ${x.status}" data-id="${x.id}" style="left:${pct(toMin(x.time))};width:calc(${(x.duration_minutes / span) * 100}% - 2px)" title="${esc(x.guest_name)} · ${x.party_size} · ${TB.time(x.time)}">
        <b>${esc(x.guest_name)}</b> (${x.party_size})<br>${TB.time(x.time)}</div>`).join('')}</div></div>`;
    body.innerHTML = `<div class="timeline"><div class="tl-grid">
      <div class="tl-hours"><div class="tl-label"></div><div class="tl-track">${lines.map((m) => `<span style="left:${pct(m)}">${TB.time(hhmm(m)).replace(':00', '')}</span>`).join('')}</div></div>
      ${tables.map((t) => row(t.label, `${t.min_seats}-${t.max_seats} seats`, active.filter((x) => x.table_id === t.id))).join('')}
      ${unassigned.length ? row('Unassigned', `${unassigned.length}`, unassigned) : ''}
    </div></div>
    <div class="legend"><span><i style="background:#2563eb;border-color:#2563eb"></i>Booked</span><span><i style="background:#16a34a;border-color:#16a34a"></i>Seated</span><span><i style="background:#9ca3af;border-color:#9ca3af"></i>Completed</span><span>Click a booking to edit it.</span></div>`;
    body.querySelectorAll('.tl-bar').forEach((b) => { b.onclick = () => reservationModal(rows.find((x) => x.id === Number(b.dataset.id)), load); });
  }

  function reservationModal(x, done) {
    const isNew = !x;
    const v = x || { date: S.date, time: '19:00', party_size: 2, guest_name: '', guest_email: '', guest_phone: '', notes: '', internal_notes: '', occasion: '', duration_minutes: 90 };
    const tables = (S.floor ? S.floor.tables : []).filter((t) => t.active);
    TB.modal(`<h2>${isNew ? 'New reservation' : `Edit reservation #${esc(v.code)}`}</h2>
      <form id="m-form">
        <div class="grid-3">
          <div class="field"><label>Date</label><input type="date" name="date" value="${v.date}" required></div>
          <div class="field"><label>Party</label><input type="number" name="party_size" min="1" max="50" value="${v.party_size}" required></div>
          <div class="field"><label>Duration (min)</label><input type="number" name="duration_minutes" min="15" step="15" value="${v.duration_minutes}"></div>
        </div>
        <div class="field"><label>Time</label><div id="m-slots" class="slots"></div><input type="hidden" name="time" value="${v.time}"></div>
        <div class="field"><label>Table</label><select name="table_id"><option value="">Auto-assign best table</option>
          ${tables.map((t) => `<option value="${t.id}"${t.id === v.table_id ? ' selected' : ''}>${esc(t.label)} (${t.min_seats}-${t.max_seats} seats)</option>`).join('')}</select></div>
        <div class="field"><label>Guest name</label><input name="name" value="${esc(v.guest_name)}" required></div>
        <div class="grid-2">
          <div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(v.guest_phone)}" required></div>
          <div class="field"><label>Email</label><input name="email" type="email" value="${esc(v.guest_email)}" required></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Occasion</label><input name="occasion" value="${esc(v.occasion)}"></div>
          ${isNew ? '<div class="field"><label>Booked via</label><select name="source"><option value="phone">Phone</option><option value="admin">In person / staff</option></select></div>' : '<div></div>'}
        </div>
        <div class="field"><label>Guest requests</label><textarea name="notes">${esc(v.notes)}</textarea></div>
        <div class="field"><label>Internal notes (staff only)</label><textarea name="internal_notes">${esc(v.internal_notes)}</textarea></div>
        <label class="check"><input type="checkbox" name="notify" checked> Email the guest ${isNew ? 'a confirmation' : 'if date/time/party changes'}</label>
        <div class="row" style="margin-top:16px"><button class="btn" type="submit">${isNew ? 'Book' : 'Save'}</button><button class="btn secondary" type="button" data-close>Close</button></div>
      </form>`,
    (m, close) => {
      const f = m.querySelector('#m-form');
      const loadSlots = async () => {
        const av = await api(`/api/admin/availability?date=${f.date.value}&party=${f.party_size.value}&ignore=${isNew ? 0 : v.id}`);
        const box = m.querySelector('#m-slots');
        const times = av.slots.length ? av.slots : [];
        if (!times.some((s) => s.time === f.time.value)) times.push({ time: f.time.value, available: false, custom: true });
        times.sort((a, b) => a.time.localeCompare(b.time));
        box.innerHTML = times.map((s) => `<button type="button" class="slot ${s.available ? '' : 'off'} ${s.time === f.time.value ? 'selected' : ''}" style="text-decoration:none;cursor:pointer" data-t="${s.time}" title="${s.available ? 'Table available' : 'No free table (you can still pick a table manually)'}">${TB.time(s.time)}</button>`).join('')
          + '<input type="time" step="300" style="width:130px" aria-label="Custom time">';
        box.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { f.time.value = b.dataset.t; box.querySelectorAll('.slot').forEach((z) => z.classList.toggle('selected', z === b)); }; });
        box.querySelector('input[type=time]').onchange = (e) => { if (e.target.value) { f.time.value = e.target.value; loadSlots(); } };
      };
      f.date.onchange = loadSlots; f.party_size.onchange = loadSlots; loadSlots().catch(fail);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const d = TB.formData(f);
        const body = {
          date: d.date, time: d.time, party_size: Number(d.party_size), duration_minutes: Number(d.duration_minutes) || 90,
          table_id: d.table_id ? Number(d.table_id) : null, notes: d.notes, internal_notes: d.internal_notes, occasion: d.occasion,
        };
        const send = async (force) => {
          if (isNew) {
            return api('/api/admin/reservations', { body: { ...body, name: d.name, phone: d.phone, email: d.email, source: d.source, send_email: d.notify, force } });
          }
          return api(`/api/admin/reservations/${v.id}`, { method: 'PATCH', body: { ...body, guest_name: d.name, guest_phone: d.phone, guest_email: d.email, notify: d.notify, force } });
        };
        try { await send(false); }
        catch (err) {
          if (err.status === 409 && body.table_id && confirm(`${err.message}\nBook it anyway (double-seat)?`)) { try { await send(true); } catch (e2) { return fail(e2); } }
          else return fail(err);
        }
        close(); TB.toast(isNew ? 'Reservation booked' : 'Reservation updated'); done && done();
      };
    });
  }

  function walkInModal(done) {
    const tables = (S.floor ? S.floor.tables : []).filter((t) => t.active);
    TB.modal(`<h2>Seat a walk-in</h2><form id="w-form">
      <div class="grid-2"><div class="field"><label>Party size</label><input type="number" name="party_size" min="1" value="2"></div>
      <div class="field"><label>Table</label><select name="table_id"><option value="">Auto-assign</option>${tables.map((t) => `<option value="${t.id}">${esc(t.label)} (${t.min_seats}-${t.max_seats})</option>`).join('')}</select></div></div>
      <div class="grid-2"><div class="field"><label>Name (optional)</label><input name="name"></div><div class="field"><label>Phone (optional)</label><input name="phone" type="tel"></div></div>
      <div class="row"><button class="btn ok" type="submit">Seat now</button><button class="btn secondary" type="button" data-close>Close</button></div></form>`,
    (m, close) => {
      m.querySelector('#w-form').onsubmit = async (e) => {
        e.preventDefault();
        const d = TB.formData(e.target);
        const now = nowLocal();
        const body = { source: 'walk_in', party_size: Number(d.party_size), name: d.name, phone: d.phone, date: now.date, time: hhmm(Math.floor(now.minutes / 5) * 5), table_id: d.table_id ? Number(d.table_id) : null };
        try { await api('/api/admin/reservations', { body }); }
        catch (err) {
          if (err.status === 409 && body.table_id && confirm(`${err.message}\nSeat anyway?`)) await api('/api/admin/reservations', { body: { ...body, force: true } }).catch(fail);
          else return fail(err);
        }
        close(); TB.toast('Walk-in seated'); S.date = now.date; done && done();
      };
    });
  }

  // ---------------- Floor plan ----------------
  const SIZE = { square: [70, 70], round: [74, 74], rect: [130, 70], booth: [110, 70], bar: [150, 44] };
  function tableSize(t) {
    const [w, h] = SIZE[t.shape] || SIZE.square;
    const grow = Math.max(0, t.max_seats - (t.shape === 'rect' || t.shape === 'bar' ? 6 : 4)) * 12;
    return [w + (t.shape === 'round' ? grow / 2 : grow), h + (t.shape === 'round' ? grow / 2 : 0)];
  }
  function chairs(t, w, h) {
    const n = Math.min(t.max_seats, 16); const out = [];
    if (t.shape === 'round') {
      const r = Math.max(w, h) / 2 + 9;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; out.push([w / 2 + Math.cos(a) * r - 6, h / 2 + Math.sin(a) * r - 6]); }
    } else if (t.shape === 'bar' || t.shape === 'booth') {
      for (let i = 0; i < n; i++) out.push([((i + 0.5) / n) * w - 6, t.shape === 'bar' ? h + 4 : -16]);
    } else {
      const top = Math.ceil(n / 2); const bottom = n - top;
      for (let i = 0; i < top; i++) out.push([((i + 0.5) / top) * w - 6, -16]);
      for (let i = 0; i < bottom; i++) out.push([((i + 0.5) / bottom) * w - 6, h + 4]);
    }
    return out.map(([x, y]) => `<span class="chair" style="left:${x}px;top:${y}px"></span>`).join('');
  }

  async function viewFloor() {
    const floor = await api('/api/admin/floor');
    S.floor = floor;
    if (!S.floorArea || !floor.areas.some((a) => a.id === S.floorArea)) S.floorArea = floor.areas[0] ? floor.areas[0].id : null;
    const now = nowLocal();
    S.floorTime = S.floorTime || hhmm(Math.max(17 * 60, Math.ceil(now.minutes / 15) * 15));
    const resv = (await api(`/api/admin/reservations?date=${S.date}`)).reservations.filter((x) => ['confirmed', 'seated'].includes(x.status));
    const seats = floor.tables.filter((t) => t.active).reduce((s, t) => s + t.max_seats, 0);
    view.innerHTML = `
      <div class="toolbar">
        <div class="seg" id="areas">${floor.areas.map((a) => `<button data-a="${a.id}" class="${a.id === S.floorArea ? 'on' : ''}">${esc(a.name)}</button>`).join('')}<button data-a="">Unassigned</button></div>
        <button class="btn secondary sm" id="add-area">+ Room</button>
        ${S.floorArea ? '<button class="btn secondary sm" id="ren-area">Rename</button><button class="btn secondary sm" id="del-area">Delete room</button>' : ''}
        <span class="spacer"></span>
        <span class="muted small">Live status:</span><input type="date" id="f-date" value="${S.date}" style="width:auto"><input type="time" id="f-time" step="900" value="${S.floorTime}" style="width:auto">
        <button class="btn" id="add-table">+ Add table</button>
      </div>
      <div class="floor-wrap">
        <div>
          <div class="canvas-scroll"><div class="canvas" id="canvas"></div></div>
          <div class="legend"><span><i></i>Free</span><span><i style="background:#dbeafe;border-color:#2563eb"></i>Booked at this time</span><span><i style="background:#dcfce7;border-color:#16a34a"></i>Seated</span><span><i style="border-style:dashed"></i>Not bookable online</span>
            <span><b>${floor.tables.filter((t) => t.active).length}</b> tables · <b>${seats}</b> seats total</span><span>Drag tables to arrange. Click to edit.</span></div>
        </div>
        <div class="card" id="tpanel"><p class="muted" style="margin:0">Select a table to edit its seats, shape and settings, or add a new one.</p></div>
      </div>`;
    const canvas = document.getElementById('canvas');
    const t0 = toMin(S.floorTime);
    const busy = (t) => resv.find((x) => x.table_id === t.id && toMin(x.time) <= t0 && toMin(x.time) + x.duration_minutes > t0);
    const visible = floor.tables.filter((t) => (S.floorArea ? t.area_id === S.floorArea : !t.area_id));
    canvas.innerHTML = visible.map((t) => {
      const [w, h] = tableSize(t);
      const b = busy(t);
      return `<div class="ftable ${t.shape} ${t.online_bookable ? '' : 'offline'} ${t.active ? '' : 'inactive'} ${b ? `busy-${b.status}` : ''} ${S.selTable === t.id ? 'sel' : ''}"
        data-id="${t.id}" style="left:${t.x}px;top:${t.y}px;width:${w}px;height:${h}px;transform:rotate(${t.rotation}deg)"
        title="${b ? `${esc(b.guest_name)} (${b.party_size}) ${TB.time(b.time)}` : ''}">
        <div>${esc(t.label)}<small>${t.min_seats}-${t.max_seats} seats</small>${b ? `<small>${esc(b.guest_name.split(' ')[0])} · ${b.party_size}</small>` : ''}</div>${chairs(t, w, h)}</div>`;
    }).join('') || '<p class="muted" style="padding:20px">No tables in this room yet. Click “+ Add table”.</p>';

    // Drag and drop
    canvas.querySelectorAll('.ftable').forEach((el) => {
      let sx; let sy; let ox; let oy; let moved = false;
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId); sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop; moved = false; el.style.cursor = 'grabbing';
      });
      el.addEventListener('pointermove', (e) => {
        if (sx === undefined) return;
        const dx = e.clientX - sx; const dy = e.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (!moved) return;
        el.style.left = `${Math.max(0, Math.min(canvas.clientWidth - el.offsetWidth, Math.round((ox + dx) / 10) * 10))}px`;
        el.style.top = `${Math.max(0, Math.min(canvas.clientHeight - el.offsetHeight, Math.round((oy + dy) / 10) * 10))}px`;
      });
      el.addEventListener('pointerup', async () => {
        sx = undefined; el.style.cursor = '';
        const id = Number(el.dataset.id);
        if (moved) {
          const t = floor.tables.find((z) => z.id === id);
          t.x = el.offsetLeft; t.y = el.offsetTop;
          api('/api/admin/floor/layout', { method: 'PUT', body: { tables: [{ id, x: t.x, y: t.y, rotation: t.rotation }] } }).catch(fail);
        } else { S.selTable = id; canvas.querySelectorAll('.ftable').forEach((z) => z.classList.toggle('sel', z === el)); tablePanel(floor.tables.find((z) => z.id === id)); }
      });
    });

    document.querySelectorAll('#areas button').forEach((b) => { b.onclick = () => { S.floorArea = b.dataset.a ? Number(b.dataset.a) : null; S.selTable = null; viewFloor().catch(fail); }; });
    document.getElementById('f-date').onchange = (e) => { S.date = e.target.value; viewFloor().catch(fail); };
    document.getElementById('f-time').onchange = (e) => { S.floorTime = e.target.value; viewFloor().catch(fail); };
    document.getElementById('add-area').onclick = async () => {
      const name = prompt('Room name (e.g. Patio, Bar, Private room)'); if (!name) return;
      const a = await api('/api/admin/areas', { body: { name, sort_order: floor.areas.length } }).catch(fail);
      if (a) { S.floorArea = a.id; viewFloor().catch(fail); }
    };
    if (S.floorArea) {
      document.getElementById('ren-area').onclick = async () => {
        const a = floor.areas.find((z) => z.id === S.floorArea); const name = prompt('Rename room', a.name); if (!name) return;
        await api(`/api/admin/areas/${a.id}`, { method: 'PUT', body: { name } }).catch(fail); viewFloor().catch(fail);
      };
      document.getElementById('del-area').onclick = async () => {
        if (!confirm('Delete this room? Its tables move to "Unassigned".')) return;
        await api(`/api/admin/areas/${S.floorArea}`, { method: 'DELETE' }).catch(fail); S.floorArea = null; viewFloor().catch(fail);
      };
    }
    document.getElementById('add-table').onclick = () => tablePanel({ label: `T${floor.tables.length + 1}`, min_seats: 2, max_seats: 4, shape: 'square', area_id: S.floorArea, online_bookable: 1, active: 1, rotation: 0, x: 40, y: 40 });
    const sel = floor.tables.find((z) => z.id === S.selTable);
    if (sel) tablePanel(sel);
  }

  function tablePanel(t) {
    const isNew = !t.id;
    const p = document.getElementById('tpanel');
    p.innerHTML = `<h2>${isNew ? 'New table' : `Table ${esc(t.label)}`}</h2><form id="t-form">
      <div class="grid-2"><div class="field"><label>Label</label><input name="label" value="${esc(t.label)}" required></div>
      <div class="field"><label>Shape</label><select name="shape">${['square', 'round', 'rect', 'booth', 'bar'].map((s) => `<option value="${s}"${s === t.shape ? ' selected' : ''}>${{ square: 'Square', round: 'Round', rect: 'Long / rectangle', booth: 'Booth', bar: 'Bar / counter' }[s]}</option>`).join('')}</select></div></div>
      <div class="grid-2"><div class="field"><label>Min seats (chairs)</label><input type="number" name="min_seats" min="1" max="40" value="${t.min_seats}"></div>
      <div class="field"><label>Max seats (chairs)</label><input type="number" name="max_seats" min="1" max="40" value="${t.max_seats}"></div></div>
      <div class="grid-2"><div class="field"><label>Room</label><select name="area_id"><option value="">Unassigned</option>${S.floor.areas.map((a) => `<option value="${a.id}"${a.id === t.area_id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Rotation</label><select name="rotation">${[0, 45, 90, 135].map((d) => `<option value="${d}"${d === t.rotation ? ' selected' : ''}>${d}°</option>`).join('')}</select></div></div>
      <label class="check"><input type="checkbox" name="online_bookable" ${t.online_bookable ? 'checked' : ''}> Bookable online & via widget</label>
      <label class="check" style="margin-top:6px"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Active (uncheck to take out of service)</label>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit">${isNew ? 'Add table' : 'Save'}</button>${isNew ? '' : '<button class="btn danger" type="button" id="t-del">Delete</button>'}</div></form>`;
    p.querySelector('#t-form').onsubmit = async (e) => {
      e.preventDefault();
      const d = TB.formData(e.target);
      const body = { ...d, area_id: d.area_id ? Number(d.area_id) : null, min_seats: Number(d.min_seats), max_seats: Number(d.max_seats), rotation: Number(d.rotation) };
      if (isNew) { body.x = t.x; body.y = t.y; }
      try {
        const saved = await api(isNew ? '/api/admin/tables' : `/api/admin/tables/${t.id}`, { method: isNew ? 'POST' : 'PUT', body });
        S.selTable = saved.id; TB.toast(isNew ? 'Table added' : 'Table saved'); viewFloor().catch(fail);
      } catch (err) { fail(err); }
    };
    if (!isNew) {
      p.querySelector('#t-del').onclick = async () => {
        if (!confirm(`Delete table ${t.label}? Existing reservations on it become unassigned.`)) return;
        await api(`/api/admin/tables/${t.id}`, { method: 'DELETE' }).catch(fail); S.selTable = null; viewFloor().catch(fail);
      };
    }
  }

  // ---------------- Services / shifts ----------------
  async function viewServices() {
    const { shifts, closures } = await api('/api/admin/shifts');
    view.innerHTML = `<div class="two-col"><div>
        <div class="row" style="margin-bottom:12px"><h2 style="margin:0">Services</h2><span class="spacer"></span><button class="btn" id="add-shift">+ Add service</button></div>
        <div id="shift-list"></div></div>
      <div class="card"><h2>Closed dates & holidays</h2><p class="muted small">No online bookings are taken on these dates.</p>
        <form id="c-form" class="row"><input type="date" name="date" required style="width:auto"><input name="reason" placeholder="Reason (optional)" style="flex:1;min-width:140px"><button class="btn secondary" type="submit">Add</button></form>
        <table class="data" style="margin-top:12px">${closures.map((c) => `<tr><td>${TB.date(c.date, { year: 'numeric' })}</td><td>${esc(c.reason)}</td><td style="text-align:right"><button class="btn ghost sm" data-del="${c.id}">Remove</button></td></tr>`).join('') || '<tr><td class="muted">No closed dates.</td></tr>'}</table>
      </div></div>`;
    const list = document.getElementById('shift-list');
    const card = (s) => `<form class="card shift-card" data-id="${s.id || ''}">
      <div class="grid-2"><div class="field"><label>Service name</label><input name="name" value="${esc(s.name)}" required></div>
      <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active</label></div></div>
      <div class="field"><label>Days</label><div class="days">${DAY_NAMES.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${s.days.split(',').includes(String(i)) ? 'checked' : ''}>${d}</label>`).join('')}</div></div>
      <div class="grid-3">
        <div class="field"><label>First seating</label><input type="time" name="start_time" value="${s.start_time}" required></div>
        <div class="field"><label>Last seating</label><input type="time" name="end_time" value="${s.end_time}" required></div>
        <div class="field"><label>Slot every (min)</label><select name="slot_interval">${[10, 15, 20, 30, 60].map((n) => `<option${n === s.slot_interval ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Table turn time (min)</label><input type="number" name="turn_minutes" min="15" step="15" value="${s.turn_minutes}"></div>
        <div class="field"><label>Max covers per slot (0 = no limit)</label><input type="number" name="max_covers_per_slot" min="0" value="${s.max_covers_per_slot}"></div>
      </div>
      <div class="row"><button class="btn" type="submit">${s.id ? 'Save' : 'Create service'}</button>${s.id ? '<button class="btn ghost" type="button" data-del-shift>Delete</button>' : ''}</div></form>`;
    list.innerHTML = shifts.map(card).join('') || '<p class="muted">No services yet. Add one so guests can book.</p>';
    const bind = () => list.querySelectorAll('form').forEach((f) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const days = [...f.querySelectorAll('input[name=day]:checked')].map((x) => x.value);
        const body = { name: f.name.value, active: f.active.checked, days, start_time: f.start_time.value, end_time: f.end_time.value,
          slot_interval: Number(f.slot_interval.value), turn_minutes: Number(f.turn_minutes.value), max_covers_per_slot: Number(f.max_covers_per_slot.value) };
        if (!days.length) return TB.toast('Pick at least one day', true);
        if (body.end_time < body.start_time) return TB.toast('Last seating must be after first seating', true);
        try {
          await api(f.dataset.id ? `/api/admin/shifts/${f.dataset.id}` : '/api/admin/shifts', { method: f.dataset.id ? 'PUT' : 'POST', body });
          TB.toast('Service saved'); viewServices().catch(fail);
        } catch (err) { fail(err); }
      };
      const del = f.querySelector('[data-del-shift]');
      if (del) del.onclick = async () => { if (confirm('Delete this service?')) { await api(`/api/admin/shifts/${f.dataset.id}`, { method: 'DELETE' }).catch(fail); viewServices().catch(fail); } };
    });
    bind();
    document.getElementById('add-shift').onclick = () => {
      list.insertAdjacentHTML('afterbegin', card({ name: 'Dinner', active: 1, days: '0,1,2,3,4,5,6', start_time: '17:00', end_time: '21:30', slot_interval: 15, turn_minutes: 90, max_covers_per_slot: 0 }));
      bind();
    };
    document.getElementById('c-form').onsubmit = async (e) => {
      e.preventDefault();
      await api('/api/admin/closures', { body: TB.formData(e.target) }).catch(fail); viewServices().catch(fail);
    };
    view.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await api(`/api/admin/closures/${b.dataset.del}`, { method: 'DELETE' }).catch(fail); viewServices().catch(fail); }; });
  }

  // ---------------- Guests ----------------
  async function viewGuests() {
    view.innerHTML = `<div class="toolbar"><input type="search" id="g-q" placeholder="Search guests by name, email or phone" style="width:320px"></div><div id="g-list"></div>`;
    const load = async () => {
      const rows = await api(`/api/admin/guests?q=${encodeURIComponent(document.getElementById('g-q').value)}`);
      document.getElementById('g-list').innerHTML = `<div class="card" style="padding:0"><div class="table-wrap"><table class="data">
        <thead><tr><th>Guest</th><th>Phone</th><th>Reservations</th><th>Visits</th><th>No-shows</th><th>Cancelled</th><th>Last date</th></tr></thead>
        <tbody>${rows.map((g) => `<tr><td><b>${esc(g.name)}</b><br><span class="muted">${esc(g.email)}</span></td><td><a href="tel:${esc(g.phone)}">${esc(g.phone)}</a></td>
          <td>${g.reservations}</td><td>${g.visits || 0}</td><td>${g.no_shows ? `<span class="tag warn">${g.no_shows}</span>` : 0}</td><td>${g.cancellations || 0}</td><td>${TB.date(g.last_date)}</td></tr>`).join('')
          || '<tr><td colspan="7" class="muted">No guests yet.</td></tr>'}</tbody></table></div></div>`;
    };
    let timer; document.getElementById('g-q').oninput = () => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 250); };
    await load();
  }

  // ---------------- Widget ----------------
  async function viewWidget() {
    const r = S.me.restaurant; const base = S.me.baseUrl;
    const inline = `<div data-tablebird="${r.slug}"></div>\n<script src="${base}/widget.js" async></script>`;
    const button = `<script src="${base}/widget.js" data-restaurant="${r.slug}" data-mode="button" data-color="${r.accent_color}" data-label="Reserve a table" async></script>`;
    const iframe = `<iframe src="${base}/embed.html?r=${r.slug}" title="Reserve a table" style="width:100%;max-width:480px;height:640px;border:0"></iframe>`;
    const link = `${base}/restaurant?slug=${r.slug}`;
    const block = (title, desc, code) => `<div class="card" style="margin-bottom:14px"><h2>${title}</h2><p class="muted small">${desc}</p><pre class="code">${esc(code)}</pre><button class="btn secondary sm" data-copy="${esc(code)}">Copy</button></div>`;
    view.innerHTML = `<div class="two-col"><div>
      ${block('Option 1: Inline booking widget', 'Paste where you want the booking form to appear (e.g. your Reservations page). Works with WordPress, Squarespace, Wix and plain HTML (use an “Embed / Custom HTML” block).', inline)}
      ${block('Option 2: Floating “Reserve” button', 'Paste before &lt;/body&gt; on every page. Shows a button in the corner that opens the booking form.', button)}
      ${block('Option 3: Plain iframe', 'For site builders that only allow iframes.', iframe)}
      ${block('Direct booking link', 'Use on Instagram, Google Business Profile, emails and QR codes.', link)}
      </div><div class="card"><h2>Live preview</h2><p class="muted small">This is exactly what guests see on your site.</p>
        <iframe src="/embed.html?r=${r.slug}" title="Widget preview" style="width:100%;height:680px;border:0"></iframe></div></div>`;
    view.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy).then(() => TB.toast('Copied to clipboard')).catch(() => TB.toast('Select the code and copy it manually', true)); }; });
  }

  // ---------------- Settings ----------------
  async function viewSettings() {
    const r = (await api('/api/admin/restaurant')).restaurant;
    const tzs = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
    if (!tzs.includes(r.timezone)) tzs.push(r.timezone);
    view.innerHTML = `<form id="s-form"><div class="two-col">
      <div class="card"><h2>Restaurant profile</h2>
        <div class="field"><label>Name</label><input name="name" value="${esc(r.name)}"></div>
        <div class="grid-2"><div class="field"><label>Cuisine</label><input name="cuisine" value="${esc(r.cuisine)}"></div>
        <div class="field"><label>Price</label><select name="price_level">${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === r.price_level ? ' selected' : ''}>${'$'.repeat(n)}</option>`).join('')}</select></div></div>
        <div class="field"><label>Description</label><textarea name="description">${esc(r.description)}</textarea></div>
        <div class="grid-2"><div class="field"><label>Phone</label><input name="phone" value="${esc(r.phone)}"></div>
        <div class="field"><label>Notification email (new bookings / cancellations)</label><input name="email" type="email" value="${esc(r.email)}"></div></div>
        <div class="field"><label>Street address</label><input name="address" value="${esc(r.address)}"></div>
        <div class="grid-3"><div class="field"><label>City</label><input name="city" value="${esc(r.city)}"></div>
        <div class="field"><label>State</label><input name="state" value="${esc(r.state)}" maxlength="2"></div>
        <div class="field"><label>ZIP</label><input name="zip" value="${esc(r.zip)}" maxlength="5"></div></div>
        <div class="grid-2"><div class="field"><label>Time zone</label><select name="timezone">${tzs.map((z) => `<option${z === r.timezone ? ' selected' : ''}>${z}</option>`).join('')}</select></div>
        <div class="field"><label>Brand color</label><input type="color" name="accent_color" value="${esc(r.accent_color)}" style="height:44px;padding:4px"></div></div>
        <div class="field"><label>Photo URL (optional)</label><input name="image_url" value="${esc(r.image_url)}" placeholder="https://…"></div>
        <div class="field"><label>What describes you? (used by search and “Pick for me”)</label>
          <div class="days">${TBMatch.TAGS.map((t) => `<label><input type="checkbox" data-tag="${t.id}" ${TBMatch.parseTags(r.tags).includes(t.id) ? 'checked' : ''}>${esc(t.label)}</label>`).join('')}</div>
          ${r.featured ? '<p class="small" style="margin-top:8px"><span class="feat-badge">Featured</span> Your restaurant is featured on the Tablebird home page.</p>' : ''}</div>
      </div>
      <div>
        <div class="card" style="margin-bottom:16px"><h2>Booking rules</h2>
          <div class="grid-3"><div class="field"><label>Max party online</label><input type="number" name="max_party_size" min="1" value="${r.max_party_size}"></div>
          <div class="field"><label>Book up to (days ahead)</label><input type="number" name="booking_window_days" min="1" value="${r.booking_window_days}"></div>
          <div class="field"><label>Min notice (minutes)</label><input type="number" name="min_notice_minutes" min="0" step="15" value="${r.min_notice_minutes}"></div></div>
          <div class="field"><label>Cancellation policy (shown to guests)</label><textarea name="cancellation_policy">${esc(r.cancellation_policy)}</textarea></div>
        </div>
        <div class="card" style="margin-bottom:16px"><h2>Reminders</h2>
          <div class="field"><label>Send reminder email this many hours before (0 = off)</label><input type="number" name="reminder_hours" min="0" value="${r.reminder_hours}"></div>
        </div>
        <div class="card"><h2>No-shows</h2>
          <label class="check"><input type="checkbox" name="auto_no_show" ${r.auto_no_show ? 'checked' : ''}> Automatically mark guests as no-show if not seated</label>
          <div class="field" style="margin-top:10px"><label>…after this many minutes past the reservation time</label><input type="number" name="no_show_grace_minutes" min="5" step="5" value="${r.no_show_grace_minutes}"></div>
          <label class="check"><input type="checkbox" name="send_no_show_email" ${r.send_no_show_email ? 'checked' : ''}> Email guests when marked as no-show</label>
        </div>
      </div></div>
      <div style="margin-top:16px"><button class="btn lg" type="submit">Save settings</button></div></form>`;
    document.getElementById('s-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const body = TB.formData(e.target);
        body.tags = [...e.target.querySelectorAll('[data-tag]:checked')].map((x) => x.dataset.tag);
        await api('/api/admin/restaurant', { method: 'PUT', body });
        S.me = await api('/api/admin/restaurant');
        document.getElementById('rest-name').textContent = S.me.restaurant.name;
        document.documentElement.style.setProperty('--brand', S.me.restaurant.accent_color);
        TB.toast('Settings saved');
      } catch (err) { fail(err); }
    };
  }

  // ---------------- Billing ----------------
  async function viewBilling() {
    const b = await api('/api/admin/billing');
    S.me.billing = b; renderBanner();
    const statusText = { trialing: `Free trial, ${b.trialDaysLeft} day${b.trialDaysLeft === 1 ? '' : 's'} left`, active: 'Active subscription', past_due: 'Payment past due', canceled: 'Cancelled', expired: 'Trial ended' }[b.status];
    const ok = location.hash.includes('checkout=success');
    view.innerHTML = `<div class="two-col"><div class="card">
      ${ok ? '<div class="alert ok" style="margin-bottom:14px">Thanks! Your payment method was saved. It can take a few seconds for the status to update.</div>' : ''}
      <h2>Your plan</h2>
      <p style="font-size:28px;margin:0" class="serif">$20<span class="muted" style="font-size:16px">/month</span></p>
      <p>Status: <b>${statusText}</b>${b.status === 'trialing' ? `<br><span class="muted small">Trial ends ${new Date(b.trialEndsAt).toLocaleDateString()}. You won't be charged before then.</span>` : ''}</p>
      <div class="row">
        ${b.hasPaymentMethod ? '<button class="btn" id="portal">Manage billing & invoices</button>' : `<button class="btn" id="checkout">${b.status === 'trialing' ? 'Add payment method' : 'Subscribe for $20/month'}</button>`}
      </div>
      ${b.demoMode ? `<div class="alert" style="margin-top:18px"><b>Demo mode:</b> Stripe keys aren't configured, so no real payments happen. Use these buttons to try each state.
        <div class="row" style="margin-top:10px"><button class="btn secondary sm" data-sim="active">Simulate paid</button><button class="btn secondary sm" data-sim="expired">Simulate trial ended</button></div></div>` : ''}
    </div>
    <div class="card"><h2>How billing works</h2><ul style="line-height:1.9">
      <li>Every restaurant gets <b>30 days free</b>, no card needed.</li>
      <li>Add a card any time during the trial. Your first $20 charge happens when the trial ends.</li>
      <li>If the trial ends without a card, you're hidden from search and the widget pauses. Your data is kept.</li>
      <li>Cancel any time from “Manage billing”.</li></ul></div></div>`;
    const go = async (path) => { try { const { url } = await api(path, { body: {} }); location.href = url; } catch (e) { fail(e); } };
    const c = document.getElementById('checkout'); if (c) c.onclick = () => (b.demoMode ? TB.toast('Stripe is not configured; use the demo buttons below.', true) : go('/api/admin/billing/checkout'));
    const p = document.getElementById('portal'); if (p) p.onclick = () => go('/api/admin/billing/portal');
    view.querySelectorAll('[data-sim]').forEach((x) => { x.onclick = async () => { await api('/api/admin/billing/simulate', { body: { status: x.dataset.sim } }).catch(fail); viewBilling().catch(fail); }; });
  }

  // ---------------- Email log ----------------
  async function viewEmails() {
    const rows = await api('/api/admin/emails');
    view.innerHTML = `<div class="card" style="padding:0"><div class="table-wrap"><table class="data">
      <thead><tr><th>Sent (UTC)</th><th>Type</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
      <tbody>${rows.map((e) => `<tr><td>${esc(e.created_at)}</td><td>${esc(e.kind.replace('_', ' '))}</td><td>${esc(e.to_addr)}</td>
        <td><a href="/api/admin/emails/${e.id}" target="_blank" rel="noopener">${esc(e.subject)}</a></td>
        <td><span class="badge ${e.status === 'failed' ? 'cancelled' : e.status === 'sent' ? 'seated' : ''}">${e.status === 'outbox' ? 'not sent (no SMTP)' : esc(e.status)}</span>${e.error ? `<div class="small muted">${esc(e.error)}</div>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No emails yet.</td></tr>'}</tbody></table></div></div>`;
  }

  boot();
})();
