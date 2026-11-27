/* Booking flow used by the restaurant page and the embeddable widget. */
(function () {
  const { api, esc } = TB;

  TB.mountBooking = async function (root, opts) {
    const state = { date: opts.date, party: Number(opts.party) || 2, time: opts.time || null, restaurant: null, today: null };
    let info;
    try {
      info = await api(`/api/public/restaurants/${encodeURIComponent(opts.slug)}`);
    } catch (e) {
      root.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
      return null;
    }
    const r = info.restaurant;
    state.restaurant = r;
    state.today = info.today; state.booked_today = info.booked_today || 0;
    state.menu = info.menu || [];
    state.gallery = info.gallery || [];
    state.reviews = info.reviews || null;

    // ---- Online waitlist (today only): join the line, see your place, leave ----
    const WKEY = `rb_wait_${r.slug}`;
    const getTok = () => { try { return localStorage.getItem(WKEY); } catch { return null; } };
    const setTok = (t) => { try { if (t) localStorage.setItem(WKEY, t); else localStorage.removeItem(WKEY); } catch { /* private mode */ } };
    const waitBtn = (label) => (info.waitlist ? `<button type="button" class="btn block wl-join" style="margin-top:10px">🕒 ${label}</button>` : '');
    function waitStatus(box, w) {
      const done = w.status !== 'confirmed';
      if (done) setTok(null);
      box.innerHTML = `<div class="wl-card"><div class="wl-big">${done ? (w.status === 'seated' ? '🎉' : '👋') : `#${w.position}`}</div>
        <h3 class="serif" style="margin:4px 0">${done ? (w.status === 'seated' ? "You're seated. Enjoy!" : "You're off the waitlist") : "You're on the waitlist!"}</h3>
        ${done ? '' : `<p class="muted" style="margin:0 0 10px">${w.position === 1 ? "You're next in line." : `${w.position - 1} ${w.position === 2 ? 'party' : 'parties'} ahead of you.`} Party of ${w.party_size}. Please stay close. ${esc(r.name)} will call you when your table is ready.</p>
        <button type="button" class="btn secondary block" id="wl-refresh">Refresh my spot</button><button type="button" class="btn ghost block" id="wl-leave">Leave the waitlist</button>`}</div>`;
      const rf = box.querySelector('#wl-refresh'); if (rf) rf.onclick = () => showWait(box);
      const lv = box.querySelector('#wl-leave');
      if (lv) lv.onclick = async () => { lv.disabled = true; try { await api(`/api/public/waitlist/${encodeURIComponent(w.token)}/leave`, { method: 'POST', body: {} }); } catch { /* */ } setTok(null); waitStatus(box, { ...w, status: 'cancelled' }); };
    }
    async function showWait(box) {
      const t = getTok(); if (!t) return false;
      try { const w = await api(`/api/public/waitlist/${encodeURIComponent(t)}`); if (w.date !== info.today) { setTok(null); return false; } waitStatus(box, w); return true; } catch { setTok(null); return false; }
    }
    function waitForm(box) {
      box.innerHTML = `<form class="wl-form"><h3 class="serif" style="margin:0 0 4px">Join today's waitlist</h3>
        <p class="muted small" style="margin:0 0 10px">Get in line for a table at ${esc(r.name)}. They'll call you when it's ready.</p>
        <label class="field"><span>Party size</span><select name="party_size">${TB.partyOptions(state.party, 20)}</select></label>
        <label class="field"><span>Name</span><input name="name" autocomplete="name" required></label>
        <label class="field"><span>Mobile number</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" required></label>
        <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
        <div class="wl-msg"></div><button class="btn block" type="submit">Join the waitlist</button></form>`;
      box.querySelector('form').onsubmit = async (e) => {
        e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); const b = e.target.querySelector('button[type=submit]');
        b.disabled = true; b.textContent = 'Joining…';
        try { const w = await api(`/api/public/restaurants/${encodeURIComponent(r.slug)}/waitlist`, { method: 'POST', body: { ...d, party_size: Number(d.party_size) } }); setTok(w.token); waitStatus(box, w); }
        catch (err) { box.querySelector('.wl-msg').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; b.disabled = false; b.textContent = 'Join the waitlist'; }
      };
    }
    const bindWait = (el) => { const b = el.querySelector('.wl-join'); if (b) b.onclick = () => waitForm(b.closest('.wl-slot') || root); };
    if (info.waitlist && getTok() && await showWait(root)) return state; // already in line today
    state.special = info.special || [];
    if (!state.date || state.date < info.today) state.date = info.today;
    if (r.accent_color) root.style.setProperty('--brand', r.accent_color);
    const maxDate = TB.addDays(info.today, r.booking_window_days);
    state.exposure = !!info.exposure;
    if (state.exposure) { // walk-in-only listing: no online booking
      if (opts.compact) { root.innerHTML = `<p>${esc(r.name)} doesn't take online reservations. Walk-ins welcome!</p>`; return state; }
      const tel = r.phone ? `<a class="btn secondary block" href="tel:${esc(r.phone)}">📞 Call ${esc(r.name)}</a>` : '';
      const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${r.address}, ${r.city}, ${r.state} ${r.zip}`)}`;
      root.classList.add('walkin-card');
      root.innerHTML = `<div class="walkin-big" aria-hidden="true">🚶</div><h2 class="serif">Walk-ins welcome</h2>
        <p class="muted">${esc(r.name)} doesn't take online reservations. Just show up, or call ahead to check the wait.</p>
        <div class="wl-slot">${waitBtn('Join the waitlist')}</div>
        <div style="display:grid;gap:8px;margin-top:12px">${tel}<a class="btn ${info.waitlist ? 'secondary ' : ''}block" href="${dir}" target="_blank" rel="noopener">Get directions</a></div>
        <p class="small muted" style="margin:16px 0 0">Is this your restaurant? <a href="/for-restaurants?claim=${encodeURIComponent(r.slug)}#signup">Take reservations on Rbooked</a></p>`;
      bindWait(root);
      return state;
    }

    if (info.paused) { // the restaurant paused online bookings for now
      const tel = r.phone ? `<a class="btn secondary block" href="tel:${esc(r.phone)}">📞 Call ${esc(r.name)}</a>` : '';
      root.innerHTML = `${opts.compact ? '' : '<h2 class="serif">Make a reservation</h2>'}<p><b>Looks like the restaurant is busy right now.</b></p>
        <p class="muted">You can try walking in, or check back later when spots open up.</p><div class="wl-slot">${waitBtn('Join the waitlist')}</div>${tel}`;
      bindWait(root);
      return state;
    }

    function renderPicker() {
      root.innerHTML = `
        ${opts.compact ? `<div class="row" style="margin-bottom:12px"><b class="serif" style="font-size:20px">${esc(r.name)}</b></div>` : '<h2 class="serif">Make a reservation</h2>'}
        <div class="picker">
          <div><label for="bk-party">Party size</label><select id="bk-party">${TB.partyOptions(state.party, r.max_party_size)}</select></div>
          <div><label for="bk-date">Date</label><input id="bk-date" type="date" min="${info.today}" max="${maxDate}" value="${state.date}"></div>
        </div>
        <div id="bk-slots" style="margin-top:10px"><p class="muted">Loading times…</p></div>
        <p class="muted small" style="margin-top:14px">Larger party? Call us at <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>.</p>`;
      root.querySelector('#bk-party').onchange = (e) => { state.party = Number(e.target.value); loadSlots(); };
      root.querySelector('#bk-date').onchange = (e) => { state.date = e.target.value; loadSlots(); };
      loadSlots();
    }

    async function loadSlots() {
      const box = root.querySelector('#bk-slots');
      box.innerHTML = '<p class="muted">Loading times…</p>';
      try {
        const av = await api(`/api/public/restaurants/${r.slug}/availability?date=${state.date}&party=${state.party}`);
        if (av.closed || !av.slots.length) {
          const nice = (d) => TB.date(d, { weekday: 'long', month: 'long' });
          box.innerHTML = `<div class="alert">${av.closed ? 'The restaurant is closed' : 'No reservations are taken'} on ${esc(nice(state.date))}.${av.nextOpen ? ` <button class="btn sm" id="bk-next" style="margin-left:6px">See ${esc(nice(av.nextOpen))}</button>` : ''}</div>`;
          const nb = box.querySelector('#bk-next');
          if (nb) nb.onclick = () => { state.date = av.nextOpen; const di = root.querySelector('#bk-date'); if (di) di.value = av.nextOpen; loadSlots(); };
          return;
        }
        const byShift = {};
        av.slots.forEach((s) => { (byShift[s.shiftName] = byShift[s.shiftName] || []).push(s); });
        const anyOpen = av.slots.some((s) => s.available);
        const full = !anyOpen && state.date === info.today && info.waitlist;
        box.innerHTML = (anyOpen ? '' : `<div class="alert">Fully booked for this party size. Try another date or time.${full ? '' : ''}</div>${full ? `<div class="wl-slot">${waitBtn("Join today's waitlist")}</div>` : ''}`)
          + Object.entries(byShift).map(([name, slots]) => `
          <div class="shift-label">${esc(name)}</div>
          <div class="slots">${slots.map((s) => s.available
            ? `<button class="slot" data-time="${s.time}">${TB.time(s.time)}</button>`
            : `<span class="slot off" aria-disabled="true">${TB.time(s.time)}</span>`).join('')}</div>`).join('');
        bindWait(box);
        box.querySelectorAll('button.slot').forEach((b) => { b.onclick = () => { state.time = b.dataset.time; renderForm(); }; });
        if (state.time && opts.time) { // deep link from search results
          const btn = box.querySelector(`button.slot[data-time="${state.time}"]`);
          opts.time = null;
          if (btn) btn.click();
        }
      } catch (e) {
        box.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
      }
    }

    function renderForm() {
      root.innerHTML = `
        <button class="btn ghost sm" id="bk-back">← Change time</button>
        <div class="card" style="margin:12px 0;padding:14px;box-shadow:none;background:var(--surface-2);border:none">
          <b>${esc(r.name)}</b><br>
          <span>${TB.date(state.date, { weekday: 'long', month: 'long' })} · ${TB.time(state.time)} · ${state.party} ${state.party === 1 ? 'guest' : 'guests'}</span>
        </div>
        <form id="bk-form" novalidate>
          <div class="field"><label for="bk-name">Full name</label><input id="bk-name" name="name" autocomplete="name" required></div>
          <div class="grid-2">
            <div class="field"><label for="bk-email">Email</label><input id="bk-email" name="email" type="email" autocomplete="email" required></div>
            <div class="field"><label for="bk-phone">Phone</label><input id="bk-phone" name="phone" type="tel" autocomplete="tel" required></div>
          </div>
          <div class="field"><label for="bk-occ">Occasion (optional)</label>
            <select id="bk-occ" name="occasion"><option value="">None</option><option>Birthday</option><option>Anniversary</option><option>Date night</option><option>Business meal</option><option>Celebration</option></select></div>
          <div class="field"><label for="bk-notes">Special requests (optional)</label><textarea id="bk-notes" name="notes" maxlength="500" placeholder="Allergies, high chair, accessibility needs…"></textarea></div>
          <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
          <p class="muted small">${esc(r.cancellation_policy || '')}</p>
          <div id="bk-err"></div>
          <button class="btn lg block" type="submit">Confirm reservation</button>
        </form>`;
      root.querySelector('#bk-back').onclick = renderPicker;
      root.querySelector('#bk-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = 'Booking…';
        const body = { ...TB.formData(e.target), date: state.date, time: state.time, party_size: state.party, source: opts.source || 'online' };
        try {
          const out = await api(`/api/public/restaurants/${r.slug}/reservations`, { body });
          renderDone(out, body);
        } catch (err) {
          root.querySelector('#bk-err').innerHTML = `<div class="alert error" style="margin-bottom:12px">${esc(err.message)}</div>`;
          btn.disabled = false; btn.textContent = 'Confirm reservation';
        }
      };
    }

    function renderDone(out, body) {
      const manage = `${TB.base || location.origin}/reservation.html?t=${out.token}`;
      root.innerHTML = `<div class="confirm-box">
        <div class="tick">✓</div>
        <h2 class="serif">You Rbooked!</h2>
        <p>${esc(r.name)}<br><b>${TB.date(out.date, { weekday: 'long', month: 'long' })} at ${TB.time(out.time)}</b> · ${out.party_size} ${out.party_size === 1 ? 'guest' : 'guests'}</p>
        <p>Confirmation code<br><span class="code">${esc(out.code)}</span></p>
        <p class="muted small">We sent the details to ${esc(body.email)}.</p>
        <a class="btn secondary" href="${manage}" target="_blank" rel="noopener">View or cancel reservation</a>
      </div>`;
      if (window.parent !== window) window.parent.postMessage({ type: 'rbooked:booked', code: out.code }, '*');
    }

    renderPicker();
    return state;
  };
})();
