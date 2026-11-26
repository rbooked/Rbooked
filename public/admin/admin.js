/* Rbooked restaurant dashboard (vanilla JS single-page app). */
(function () {
  const { api, esc } = TB;
  const view = document.getElementById('view');
  const S = { me: null, date: null, mode: (() => { try { return localStorage.getItem('rb_mode') || 'floor'; } catch { return 'floor'; } })(), floorArea: null, selTable: null };
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const STATUS_LABEL = { confirmed: 'Booked', seated: 'Seated', completed: 'Finished', cancelled: 'Cancelled', no_show: 'No-show' };
  const SOURCE_LABEL = { online: 'Rbooked', widget: 'Website', phone: 'Phone', walk_in: 'Walk-in', admin: 'Staff' };

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
    document.getElementById('public-link').href = TB.rlink(r.slug);
    if (r.accent_color) document.documentElement.style.setProperty('--brand', r.accent_color);
    S.date = nowLocal().date;
    renderBanner();
    setupSteps().catch(() => {});
    document.getElementById('logout').onclick = async () => { await api('/api/auth/logout', { body: {} }); location.href = '/login'; };
    document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
    window.addEventListener('hashchange', route);
    route();
  }

  function renderBanner() {
    const b = S.me.billing;
    const el = document.getElementById('banner');
    if (b.billingOff) { el.innerHTML = ''; return; }
    if (b.status === 'expired' || b.status === 'canceled') {
      el.innerHTML = `<div class="alert error"><b>Your restaurant is hidden from search and the widget is paused.</b> ${b.status === 'expired' ? 'Your free trial has ended.' : 'Your subscription was cancelled.'} <a href="#billing">Subscribe for $49/month</a> to start taking reservations again.</div>`;
    } else if (b.status === 'trialing') {
      el.innerHTML = `<div class="alert">Free trial: <b>${b.trialDaysLeft} day${b.trialDaysLeft === 1 ? '' : 's'} left</b>. <a href="#billing">Add a payment method</a> to keep bookings flowing after your trial ($49/month).</div>`;
    } else if (b.status === 'past_due') {
      el.innerHTML = '<div class="alert error">Your last payment failed. <a href="#billing">Update your card</a> to avoid interruption.</div>';
    } else el.innerHTML = '';
  }

  const VIEWS = {
    reservations: ['Reservations', viewReservations], floor: ['Floor plan & tables', viewFloor], services: ['Services & hours', viewServices],
    guests: ['Address book', viewGuests], widget: ['Website widget', viewWidget], settings: ['Settings', viewSettings],
    billing: ['Billing', viewBilling], emails: ['Email log', viewEmails], welcome: ['Welcome', viewWelcome],
    profile: ['Restaurant profile', viewProfile], 'menu-items': ['Menu', viewMenu], gallery: ['Gallery', viewGallery], 'menu-import': ['Import your menu', viewMenuHandoff],
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
  async function viewWelcome() { S.welcome = true; history.replaceState(null, '', '#profile'); return route(); }

  // ---------------- Restaurant profile (where new restaurants start) ----------------
  const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const money = (c) => (c === null || c === undefined ? '' : `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`);

  // Shrink a photo in the browser before upload so pages stay fast.
  function resizeImage(file, maxW, maxH, type) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { reject(new Error('Pick a JPG, PNG or WebP image.')); return; }
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxW / img.width, maxH / img.height);
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d');
        if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
        resolve(c.toDataURL(type, 0.84));
      };
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function setupSteps() {
    const [floor, shifts, menu, gallery] = await Promise.all([api('/api/admin/floor'), api('/api/admin/shifts'), api('/api/admin/menu'), api('/api/admin/gallery')]);
    const r = S.me.restaurant; const b = S.me.billing;
    S.menuCount = menu.length;
    const steps = [
      ['Name, cuisine and description', !!(r.name && r.cuisine && (r.description || '').length >= 20), '#profile', 'p-about'],
      ['Main photo', !!r.image_url, '#profile', 'p-photos'],
      ['Logo', !!r.logo_url, '#profile', 'p-photos'],
      ['Opening hours', !!TBMatch.parseHours(r.hours), '#profile', 'p-hours'],
      ['Link to your website', !!r.website_url, '#profile', 'p-contact'],
      ['Menu with prices and dietary tags', menu.length >= 3, '#menu-items'],
      ['Food photos in your gallery (3 or more)', gallery.length >= 3, '#gallery'],
      ['Tables, seats and combinations', floor.tables.filter((t) => t.active).length >= 2, '#floor'],
      ['Services and reservation length', shifts.shifts.some((s) => s.active), '#services'],
      ['Payment method ($49/month after the trial)', b.hasPaymentMethod || b.status === 'active', '#billing'],
    ].filter((s) => !(b.billingOff && s[2] === '#billing'));
    const done = steps.filter((s) => s[1]).length;
    const pill = document.getElementById('setup-pill');
    if (pill) { pill.hidden = done === steps.length; pill.textContent = `${done}/${steps.length}`; }
    return { steps, done };
  }

  async function viewProfile() {
    const r = S.me.restaurant;
    const { steps, done } = await setupSteps();
    setTimeout(() => { const b = document.getElementById('tag-copy'); if (b) b.onclick = async () => { const t = TBMatch.hashtag(S.me.restaurant.name); try { await navigator.clipboard.writeText(t); TB.toast(`${t} copied`); } catch { TB.toast(t); } }; }, 0);
    const hours = TBMatch.parseHours(r.hours) || TBSamples.hoursFromShifts((await api('/api/admin/shifts')).shifts);
    const hadHours = !!TBMatch.parseHours(r.hours);
    const pct = Math.round((done / steps.length) * 100);
    view.innerHTML = `
      ${S.welcome ? `<div class="card welcome"><h2 class="serif">Welcome to Rbooked${r.name && r.name !== 'My restaurant' ? `, ${esc(r.name)}` : ''}! 🎉</h2><p style="margin:0">${S.me.billing.billingOff ? 'Your account is ready.' : 'Your 14-day free trial has started.'} Start by finding your restaurant below, then add photos and your menu. This is what guests see when they find you.</p></div>` : ''}
      <div class="card find-card"><div class="row"><b>⚡ Import from your website</b><span class="muted small">Optional. Pull in your details, hours, photos and menu, then check them. Or fill everything in by hand below.</span></div>
        <form class="find-row site-row" id="pf-form" style="margin-top:10px"><input id="pf-url" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="www.yourrestaurant.com" value="${esc(r.website_url || '')}" aria-label="Your restaurant's website"><button class="btn secondary" type="submit">Import</button></form>
        <div id="pf-results" class="find-results" role="status"></div></div>
      ${r.name && r.name !== 'My restaurant' ? `<div class="card tag-card"><div><span class="muted small">Your Rbooked hashtag</span><div class="tag-big">${esc(TBMatch.hashtag(r.name))}</div>
        <p class="small muted" style="margin:4px 0 0">Put it on your Instagram, menus and receipts. Guests can type it on Rbooked to land on your page: <b>rbooked.com/tag/${esc(TBMatch.hashtag(r.name).slice(1))}</b></p></div>
        <button class="btn secondary sm" type="button" id="tag-copy">Copy</button></div>` : ''}
      <div class="card setup ${done === steps.length ? 'complete' : ''}">
        <div class="row"><h2 style="margin:0">${done === steps.length ? '✅ Your restaurant is ready for guests' : 'Get your restaurant ready'}</h2><span class="spacer"></span><b>${done} of ${steps.length}</b></div>
        <div class="progress"><i style="width:${pct}%"></i></div>
        <ol class="steps">${steps.map(([label, ok, href, anchor]) => `<li class="${ok ? 'ok' : ''}"><a href="${href}" ${anchor ? `data-jump="${anchor}"` : ''}>${ok ? '✓' : '○'} ${esc(label)}</a></li>`).join('')}</ol>
      </div>
      <form id="p-form">
      <div class="card" id="p-photos"><div class="row"><h2 style="margin:0">Photos</h2><span class="spacer"></span><a class="btn ghost sm" href="${TB.rlink(r.slug)}">View my guest page ↗</a></div>
        <p class="muted small">Your main photo is the big picture at the top of your page and in search results. Wide photos work best (at least 1600 × 900). Your logo shows on your page and booking widget.</p>
        <div class="p-hero" id="p-hero" style="${TB.thumbStyle(r)}">
          <div class="p-logo" id="p-logo" style="${r.logo_url ? `background-image:url('${esc(r.logo_url)}')` : `background:${esc(r.accent_color)}`}">${r.logo_url ? '' : esc(TB.initials(r.name))}</div>
          <div class="p-hero-name">${esc(r.name)}</div>
          <div class="p-hero-btns"><label class="btn sm">📷 ${r.image_url ? 'Change main photo' : 'Add main photo'}<input type="file" accept="image/*" id="up-cover" hidden></label>
          <label class="btn secondary sm">${r.logo_url ? 'Change logo' : 'Add logo'}<input type="file" accept="image/*" id="up-logo" hidden></label></div>
        </div>
        <div class="row small" style="margin-top:8px">${r.image_url ? '<button type="button" class="btn ghost sm" id="rm-cover">Remove photo</button>' : ''}${r.logo_url ? '<button type="button" class="btn ghost sm" id="rm-logo">Remove logo</button>' : ''}<span class="muted">Tip: you can also drag a photo onto the picture.</span></div>
      </div>
      <div class="two-col" style="margin-top:16px">
        <div class="card" id="p-about"><h2>About your restaurant</h2>
          <div class="field"><label for="p-name">Restaurant name</label><input id="p-name" name="name" value="${esc(r.name)}" required></div>
          <div class="grid-2"><div class="field"><label for="p-cuisine">Cuisine</label><select id="p-cuisine" name="cuisine">${(TBPlaces.CUISINES.includes(r.cuisine) ? [] : [r.cuisine || '']).concat(TBPlaces.CUISINES).map((c) => `<option value="${esc(c)}"${c === (r.cuisine || '') ? ' selected' : ''}>${esc(c || 'Pick a cuisine…')}</option>`).join('')}</select></div>
          <div class="field"><label for="p-price">Price</label><select id="p-price" name="price_level">${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === r.price_level ? ' selected' : ''}>${'$'.repeat(n)} ${['Inexpensive', 'Moderate', 'Pricey', 'Fine dining'][n - 1]}</option>`).join('')}</select></div></div>
          <div class="field"><label for="p-desc">Description</label><textarea id="p-desc" name="description" rows="4" placeholder="What makes your place special? Signature dishes, atmosphere, chef…">${esc(r.description)}</textarea></div>
          <div class="field"><label>What describes you? <span class="muted small">(used in search and “Pick for me”)</span></label>
            <div class="days">${TBMatch.TAGS.map((t) => `<label><input type="checkbox" data-tag="${t.id}" ${TBMatch.parseTags(r.tags).includes(t.id) ? 'checked' : ''}>${esc(t.label)}</label>`).join('')}</div></div>
          <div class="field"><label for="p-color">Brand color</label><input id="p-color" type="color" name="accent_color" value="${esc(r.accent_color)}" style="height:44px;padding:4px;max-width:120px"></div>
        </div>
        <div>
          <div class="card" id="p-contact" style="margin-bottom:16px"><h2>Contact & location</h2>
            <div class="field"><label for="p-web">Your website</label><input id="p-web" name="website_url" value="${esc(r.website_url || '')}" placeholder="www.yourrestaurant.com" inputmode="url"></div>
            <div class="field"><label for="p-phone">Phone</label><input id="p-phone" name="phone" type="tel" value="${esc(r.phone)}"></div>
            <div class="field"><label for="p-addr">Street address</label><input id="p-addr" name="address" value="${esc(r.address)}"></div>
            <div class="grid-3"><div class="field"><label for="p-city">City</label><input id="p-city" name="city" value="${esc(r.city)}"></div>
            <div class="field"><label for="p-state">State</label><select id="p-state" name="state">${TBPlaces.STATES.map(([c, n]) => `<option value="${c}"${c === r.state ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
            <div class="field"><label for="p-zip">ZIP</label><input id="p-zip" name="zip" value="${esc(r.zip)}" maxlength="5" inputmode="numeric"></div></div>
            <p class="small muted" style="margin:0">Time zone: <b>${esc(TBPlaces.tzLabel(r.timezone))}</b>, set automatically from your ZIP code.</p>
          </div>
          <div class="card" id="p-hours"><div class="row"><h2 style="margin:0">Opening hours</h2><span class="spacer"></span><button type="button" class="btn ghost sm" id="h-copy">Copy Monday to all</button></div>
            ${hadHours ? '' : '<p class="small muted">We filled these in from your services. Adjust and save.</p>'}
            <div class="hours-ed">${hours.map((h, i) => `<div class="h-row ${h.closed ? 'closed' : ''}" data-d="${i}"><b>${DAY_LONG[i]}</b>
              <label class="check"><input type="checkbox" data-open ${h.closed ? '' : 'checked'}> Open</label>
              <input type="time" data-from value="${h.open}" aria-label="${DAY_LONG[i]} opens"><span class="muted">to</span><input type="time" data-to value="${h.close}" aria-label="${DAY_LONG[i]} closes"></div>`).join('')}</div>
          </div>
        </div>
      </div>
      <div class="savebar"><button class="btn lg" type="submit">Save profile</button><span class="muted small">Changes show on your guest page right away.</span></div>
      </form>`;
    // Import from your website: read it, let the owner untick anything, then save.
    document.getElementById('pf-form').onsubmit = async (e) => {
      e.preventDefault();
      const box = document.getElementById('pf-results'); const btn = e.target.querySelector('button');
      const url = document.getElementById('pf-url').value.trim();
      if (!url) { box.innerHTML = '<p class="muted small">Paste your website address.</p>'; return; }
      btn.disabled = true; box.innerHTML = '<p class="muted small">Reading your website… this takes a few seconds.</p>';
      try {
        const f = await TBSite.read(url);
        if (!f.found.length) { box.innerHTML = '<div class="alert">We couldn’t find much on that site. Fill in your profile below instead.</div>'; return; }
        box.innerHTML = `<div class="alert ok">Found ${esc(f.found.join(', '))}. Untick anything you don't want, then save.</div>${TBSite.choicesHtml(f, true)}
          <div class="row" style="margin-top:10px"><button class="btn" type="button" id="pf-apply">Use what's ticked</button><button class="btn ghost" type="button" id="pf-skip">Cancel</button><span class="muted small" id="pf-status"></span></div>`;
        TBSite.bindChoices(box);
        document.getElementById('pf-skip').onclick = () => { box.innerHTML = ''; };
        document.getElementById('pf-apply').onclick = async (ev) => {
          ev.target.disabled = true;
          try {
            const res = await TBSite.apply(f, TBSite.picks(box), (t) => { document.getElementById('pf-status').textContent = t; });
            S.me = await api('/api/admin/restaurant'); document.getElementById('rest-name').textContent = S.me.restaurant.name;
            if (res.errors.length) TB.toast(`Saved. ${res.errors.length} photo${res.errors.length > 1 ? 's' : ''} couldn't be copied.`, true); else TB.toast('Saved from your website');
            if (res.menuItems || res.menuPdf) { history.replaceState(null, '', '#menu-items'); viewMenuImport((await api('/api/admin/menu')).length, res.menuItems ? { items: res.menuItems } : { pdf: res.menuPdf }); return; }
            viewProfile().catch(fail);
          } catch (err) { ev.target.disabled = false; fail(err); }
        };
      } catch (err) { box.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; } finally { btn.disabled = false; }
    };

    S.welcome = false;
    view.querySelectorAll('[data-jump]').forEach((a) => { a.onclick = (e) => { const el = document.getElementById(a.dataset.jump); if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); } }; });
    view.querySelectorAll('.h-row [data-open]').forEach((c) => { c.onchange = () => c.closest('.h-row').classList.toggle('closed', !c.checked); });
    document.getElementById('h-copy').onclick = () => {
      const rows = [...view.querySelectorAll('.h-row')]; const mon = rows[1];
      rows.forEach((row) => { row.querySelector('[data-from]').value = mon.querySelector('[data-from]').value; row.querySelector('[data-to]').value = mon.querySelector('[data-to]').value; });
      TB.toast('Copied Monday’s hours to every open day');
    };
    const upload = async (file, kind) => {
      if (!file) return;
      try {
        const data = await resizeImage(file, kind === 'logo' ? 400 : 1800, kind === 'logo' ? 400 : 1100, kind === 'logo' ? 'image/png' : 'image/jpeg');
        TB.toast('Uploading…');
        await api('/api/admin/images', { body: { kind, data } });
        S.me = await api('/api/admin/restaurant'); TB.toast(kind === 'logo' ? 'Logo updated' : 'Main photo updated'); viewProfile().catch(fail);
      } catch (e) { fail(e); }
    };
    document.getElementById('up-cover').onchange = (e) => upload(e.target.files[0], 'cover');
    document.getElementById('up-logo').onchange = (e) => upload(e.target.files[0], 'logo');
    const hero = document.getElementById('p-hero');
    hero.ondragover = (e) => { e.preventDefault(); hero.classList.add('drop'); };
    hero.ondragleave = () => hero.classList.remove('drop');
    hero.ondrop = (e) => { e.preventDefault(); hero.classList.remove('drop'); const f = e.dataTransfer.files[0]; const onLogo = e.target.closest('.p-logo'); upload(f, onLogo ? 'logo' : 'cover'); };
    const clear = (field, label) => async () => {
      if (!await ask(`Remove your ${label}?`, 'Remove', true)) return;
      await api('/api/admin/restaurant', { method: 'PUT', body: { [field]: '' } }).catch(fail);
      S.me = await api('/api/admin/restaurant'); viewProfile().catch(fail);
    };
    const rc = document.getElementById('rm-cover'); if (rc) rc.onclick = clear('image_url', 'main photo');
    const rl = document.getElementById('rm-logo'); if (rl) rl.onclick = clear('logo_url', 'logo');
    document.getElementById('p-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = TB.formData(e.target);
      body.tags = [...e.target.querySelectorAll('[data-tag]:checked')].map((x) => x.dataset.tag);
      body.hours = JSON.stringify([...view.querySelectorAll('.h-row')].map((row) => ({
        closed: row.querySelector('[data-open]').checked ? 0 : 1, open: row.querySelector('[data-from]').value || '17:00', close: row.querySelector('[data-to]').value || '22:00' })));
      try {
        await api('/api/admin/restaurant', { method: 'PUT', body });
        S.me = await api('/api/admin/restaurant');
        document.getElementById('rest-name').textContent = S.me.restaurant.name;
        document.documentElement.style.setProperty('--brand', S.me.restaurant.accent_color);
        TB.toast('Profile saved'); viewProfile().catch(fail);
      } catch (err) { fail(err); }
    };
  }

  // ---------------- Menu ----------------
  async function viewMenu() {
    const items = await api('/api/admin/menu');
    const r = S.me.restaurant;
    S.menuFilter = S.menuFilter || '';
    const sections = [...new Set(items.map((m) => m.section))];
    const counts = {}; items.forEach((m) => m.tags.split(',').filter(Boolean).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    const shown = (m) => !S.menuFilter || m.tags.split(',').includes(S.menuFilter);
    view.innerHTML = `
      <div class="toolbar"><button class="btn" id="mi-add">+ Add dish</button><button class="btn secondary" id="mi-import">⬆ Import menu</button>
        <div class="chips">${['', ...TBMatch.MENU_TAGS.map((t) => t.id)].map((id) => { const t = id ? TBMatch.menuTag(id) : null; return `<button class="chip ${S.menuFilter === id ? 'on' : ''}" data-f="${id}">${t ? `${t.icon} ${esc(t.label)} <span class="muted">${counts[id] || 0}</span>` : `All <span class="muted">${items.length}</span>`}</button>`; }).join('')}</div>
        <span class="spacer"></span><a class="btn ghost sm" href="${TB.rlink(r.slug)}#menu">Preview as a guest ↗</a></div>
      ${items.length ? '' : `<div class="card empty-menu"><h2>Add your menu</h2><p>Guests can browse it on your page and filter by vegetarian, vegan, gluten-free and more. Restaurants with 3 or more vegan (or vegetarian, gluten-free, halal) dishes also show up when guests search for those.</p>
        <div class="row"><button class="btn" id="mi-import2">⬆ Import my menu</button><button class="btn secondary" id="mi-first">+ Add dishes one by one</button><button class="btn ghost" id="mi-sample">Start from a sample ${esc(r.cuisine || '')} menu</button></div></div>`}
      ${sections.map((sec) => { const list = items.filter((m) => m.section === sec && shown(m)); if (!list.length) return ''; return `<div class="card menu-sec"><div class="row"><h2 style="margin:0">${esc(sec)}</h2><span class="muted small">${list.length} item${list.length > 1 ? 's' : ''}</span><span class="spacer"></span>
          <button class="btn ghost sm" data-rename="${esc(sec)}">Rename</button><button class="btn secondary sm" data-add-in="${esc(sec)}">+ Add to ${esc(sec)}</button></div>
          <div class="menu-list">${list.map((m) => `<div class="mi-row ${m.available ? '' : 'off'}" data-id="${m.id}">
            <div class="mi-move"><button class="btn ghost sm" data-up aria-label="Move up">↑</button><button class="btn ghost sm" data-down aria-label="Move down">↓</button></div>
            <div class="mi-main"><b>${esc(m.name)}</b>${m.available ? '' : ' <span class="tag">Hidden</span>'}${m.description ? `<div class="small muted">${esc(m.description)}</div>` : ''}
              ${m.options ? `<div class="small muted mi-opts">${esc(TBMenuImport.optionsText(m.options).split('\n').join(' · '))}</div>` : ''}
              <div class="mi-tags">${TBMatch.sortMenuTags(m.tags).map((t) => `<span class="dtag">${TBMatch.menuTag(t).icon} ${esc(TBMatch.menuTag(t).label)}</span>`).join('')}</div></div>
            <div class="mi-price">${money(m.price_cents)}</div>
            <div class="mi-acts"><label class="switch" title="Show on menu"><input type="checkbox" data-avail ${m.available ? 'checked' : ''} aria-label="Show ${esc(m.name)} on menu"><i></i></label>
              <button class="btn secondary sm" data-edit>Edit</button><button class="btn ghost sm" data-del aria-label="Delete">🗑</button></div></div>`).join('')}</div></div>`; }).join('')}`;
    view.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { S.menuFilter = b.dataset.f; viewMenu().catch(fail); }; });
    const add = (section) => menuItemModal(null, sections, section);
    document.getElementById('mi-add').onclick = () => add(sections[0] || 'Starters');
    document.getElementById('mi-import').onclick = () => viewMenuImport(items.length);
    const imp2 = document.getElementById('mi-import2'); if (imp2) imp2.onclick = () => viewMenuImport(0);
    const first = document.getElementById('mi-first'); if (first) first.onclick = () => add('Starters');
    const sample = document.getElementById('mi-sample');
    if (sample) {
      sample.onclick = async () => {
        sample.disabled = true;
        try { for (const m of TBSamples.menuFor(r.cuisine)) await api('/api/admin/menu', { body: m }); TB.toast('Sample menu added. Edit the dishes and prices to match yours.'); } catch (e) { fail(e); }
        viewMenu().catch(fail); setupSteps().catch(() => {});
      };
    }
    view.querySelectorAll('[data-add-in]').forEach((b) => { b.onclick = () => add(b.dataset.addIn); });
    view.querySelectorAll('[data-rename]').forEach((b) => {
      b.onclick = async () => {
        const name = await askText('Rename section', b.dataset.rename); if (!name || name === b.dataset.rename) return;
        await Promise.all(items.filter((m) => m.section === b.dataset.rename).map((m) => api(`/api/admin/menu/${m.id}`, { method: 'PUT', body: { section: name } }))).catch(fail);
        viewMenu().catch(fail);
      };
    });
    view.querySelectorAll('.mi-row').forEach((row) => {
      const m = items.find((x) => x.id === Number(row.dataset.id));
      row.querySelector('[data-edit]').onclick = () => menuItemModal(m, sections);
      row.querySelector('[data-del]').onclick = async () => { if (await ask(`Delete “${m.name}” from your menu?`, 'Delete', true)) { await api(`/api/admin/menu/${m.id}`, { method: 'DELETE' }).catch(fail); viewMenu().catch(fail); } };
      row.querySelector('[data-avail]').onchange = async (e) => { await api(`/api/admin/menu/${m.id}`, { method: 'PUT', body: { available: e.target.checked } }).catch(fail); TB.toast(e.target.checked ? `${m.name} is on the menu` : `${m.name} is hidden (86’d)`); viewMenu().catch(fail); };
      const move = async (dir) => {
        const same = items.filter((x) => x.section === m.section); const i = same.indexOf(m); const j = i + dir;
        if (j < 0 || j >= same.length) return;
        [same[i], same[j]] = [same[j], same[i]];
        const order = sections.flatMap((s) => (s === m.section ? same : items.filter((x) => x.section === s))).map((x) => x.id);
        await api('/api/admin/menu/order', { method: 'PUT', body: { ids: order } }).catch(fail); viewMenu().catch(fail);
      };
      row.querySelector('[data-up]').onclick = () => move(-1); row.querySelector('[data-down]').onclick = () => move(1);
    });
  }

  // ---------------- Gallery: food photos diners can heart ----------------
  async function viewGallery() {
    const [photos, menu] = await Promise.all([api('/api/admin/gallery'), api('/api/admin/menu')]);
    const r = S.me.restaurant;
    const total = photos.reduce((a, p) => a + p.likes, 0);
    view.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Food gallery</h2><span class="spacer"></span><span class="muted small">${photos.length} photo${photos.length === 1 ? '' : 's'} · ♥ ${total} like${total === 1 ? '' : 's'}</span></div>
      <p class="small muted">Post photos of your dishes and your space. They show on your page and in “Dishes diners love” on the Rbooked home page. Diners tap ♡ on the ones they love.</p>
      <label class="imp-drop" id="g-drop"><input type="file" id="g-file" accept="image/*" multiple hidden><b>📸 Add photos</b><span class="muted small">Choose one or more photos (JPG, PNG or WebP)</span></label>
      <span class="muted small" id="g-status" role="status"></span></div>
      ${photos.length ? `<div class="g-admin">${photos.map((p) => `<div class="card g-card" data-id="${p.id}"><div class="g-ph"><img src="${esc(p.url)}" alt="" loading="lazy"><span class="g-likes">♥ ${p.likes}</span></div>
        <div class="field" style="margin:8px 0 6px"><label>Dish in the photo</label><select data-dish><option value="">None</option>${menu.map((m) => `<option value="${m.id}"${m.id === p.menu_item_id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        <div class="field" style="margin:0 0 8px"><label>Caption</label><input data-cap value="${esc(p.caption)}" maxlength="200" placeholder="e.g. Fresh out of the oven"></div>
        <button class="btn ghost sm" data-del>Remove</button></div>`).join('')}</div>` : `<div class="card" style="margin-top:16px"><p class="muted" style="margin:0">No photos yet. Restaurants with food photos get more bookings: add a few of your best dishes.</p></div>`}
      <p class="small" style="margin-top:12px"><a href="${TB.rlink(r.slug)}" target="_blank" rel="noopener">See your page as a guest ↗</a></p>`;
    const status = (t) => { document.getElementById('g-status').textContent = t; };
    const upload = async (files) => {
      const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 20);
      let n = 0;
      for (const f of list) {
        status(`Uploading ${++n} of ${list.length}…`);
        try { const data = await resizeImage(f, 1600, 1600, 'image/jpeg'); await api('/api/admin/images', { body: { kind: 'gallery', data } }); } catch (e) { fail(e); break; }
      }
      status(''); if (n) TB.toast(`${n} photo${n > 1 ? 's' : ''} added`); setupSteps().catch(() => {}); viewGallery().catch(fail);
    };
    const inp = document.getElementById('g-file'); inp.onchange = () => { upload(inp.files); inp.value = ''; };
    const drop = document.getElementById('g-drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); };
    view.querySelectorAll('.g-card').forEach((c) => {
      const id = c.dataset.id;
      const save = (body) => api(`/api/admin/gallery/${id}`, { method: 'PUT', body }).then(() => TB.toast('Saved')).catch(fail);
      c.querySelector('[data-dish]').onchange = (e) => save({ menu_item_id: e.target.value || null });
      c.querySelector('[data-cap]').onchange = (e) => save({ caption: e.target.value });
      c.querySelector('[data-del]').onclick = async () => { if (await ask('Remove this photo from your gallery?', 'Remove', true)) { await api(`/api/admin/gallery/${id}`, { method: 'DELETE' }).catch(fail); setupSteps().catch(() => {}); viewGallery().catch(fail); } };
    });
  }

  // ---------------- Menu import: paste, spreadsheet, PDF or photo (all read in the browser) ----------------
  const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('Could not load the file reader. Check your connection and try again.'));
    document.head.appendChild(el);
  });
  // Readers are served from Rbooked itself (public/vendor) so they work without outside CDNs.
  const LIBS = {
    pdf: '/vendor/pdfjs/pdf.min.js', pdfWorker: '/vendor/pdfjs/pdf.worker.min.js',
    ocr: '/vendor/tesseract/tesseract.min.js', xlsx: '/vendor/xlsx/xlsx.full.min.js',
  };
  const abs = (u) => new URL(u, location.href).href;
  async function ocr(image, status, label) {
    await loadScript(LIBS.ocr);
    const worker = await window.Tesseract.createWorker('eng', 1, {
      workerPath: abs('/vendor/tesseract/worker.min.js'), corePath: abs('/vendor/tesseract/core'), langPath: abs('/vendor/tesseract/lang'),
      logger: (m) => { if (m.status === 'recognizing text') status(`${label}… ${Math.round(m.progress * 100)}%`); else if (/load/.test(m.status)) status(`${label}… getting ready`); },
    });
    try { const { data } = await worker.recognize(image); return data.text; } finally { worker.terminate(); }
  }
  async function pdfText(file, status) {
    await loadScript(LIBS.pdf);
    const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = Math.min(doc.numPages, 12); let out = '';
    for (let n = 1; n <= pages; n++) {
      status(`Reading page ${n} of ${pages}…`);
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      // Group text pieces into lines by their height on the page; keep wide gaps (e.g. before prices).
      const rows = new Map();
      for (const it of tc.items) { if (!it.str.trim()) continue; const y = Math.round(it.transform[5] / 3); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(it); }
      const text = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => its.sort((a, b) => a.transform[4] - b.transform[4])
        .reduce((acc, it, i, arr) => {
          // Space between pieces by the gap relative to the font size, so letter-spaced fonts don't become "F r i e d"
          // and tightly set words don't run together.
          const prev = arr[i - 1]; if (!prev) return it.str;
          const size = Math.abs(it.transform[0]) || it.height || 10;
          const gap = it.transform[4] - (prev.transform[4] + prev.width);
          const sep = gap > size * 1.5 ? '   ' : gap > size * 0.28 && !/\s$/.test(acc) && !/^\s/.test(it.str) ? ' ' : '';
          return acc + sep + it.str;
        }, '').replace(/[ \t]{4,}/g, '   ')).join('\n');
      if (text.replace(/\s/g, '').length > 20) { out += `${text}\n`; continue; }
      // A scanned page with no text: read it like a photo.
      const vp = page.getViewport({ scale: 2 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      out += `${await ocr(c, status, `Reading scanned page ${n} of ${pages}`)}\n`;
    }
    return out;
  }
  // Smart reading on the server (sections, prices, sizes, add-ons). If it's slow or unavailable, the quick
  // built-in reader is used, so the owner never waits more than ~25 seconds.
  async function smartRead(text, status) {
    if (!String(text || '').trim()) return [];
    const t0 = Date.now(); const steps = ['Finding sections', 'Reading dishes and prices', 'Picking up sizes and add-ons', 'Tidying up'];
    const tick = () => { const s = Math.floor((Date.now() - t0) / 1000); if (status) status(`${steps[Math.min(steps.length - 1, Math.floor(s / 5))]}… ${s}s`); };
    tick(); const iv = setInterval(tick, 1000);
    const ctl = new AbortController(); const stop = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(`${TB.base}/api/admin/menu/read`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ctl.signal });
      const d = r.ok ? await r.json() : null;
      if (d && d.smart && d.items.length) return d.items;
    } catch { /* slow or offline: quick reader below */ } finally { clearInterval(iv); clearTimeout(stop); }
    return TBMenuImport.parseText(text);
  }
  async function readMenuFile(file, status) {
    const name = file.name.toLowerCase();
    if (/\.(csv|tsv)$/.test(name)) return TBMenuImport.parseCSV(await file.text());
    if (/\.(xlsx|xls|ods)$/.test(name)) {
      status('Reading spreadsheet…'); await loadScript(LIBS.xlsx);
      const wb = window.XLSX.read(await file.arrayBuffer());
      return wb.SheetNames.flatMap((n) => TBMenuImport.parseRows(window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }).map((r) => r.map(String))));
    }
    if (/\.pdf$/.test(name) || file.type === 'application/pdf') return smartRead(await pdfText(file, status), status);
    if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/.test(name)) return smartRead(await ocr(file, status, 'Reading your photo'), status);
    if (/\.(txt|md)$/.test(name) || file.type.startsWith('text/')) return smartRead(await file.text(), status);
    throw new Error('Pick a PDF, a photo, an Excel/CSV file, or paste your menu as text.');
  }

  // Signup handed us a menu from the restaurant's website.
  async function viewMenuHandoff() {
    let preset = null; try { preset = JSON.parse(sessionStorage.getItem('rb_site_menu') || 'null'); sessionStorage.removeItem('rb_site_menu'); } catch { /* ignore */ }
    history.replaceState(null, '', '#menu-items');
    viewMenuImport((await api('/api/admin/menu')).length, preset);
  }

  function viewMenuImport(existing, preset) {
    let rows = [];
    document.getElementById('view-title').textContent = 'Import your menu';
    view.innerHTML = `<div class="card imp-start"><h2>Import your menu</h2>
      <p class="muted">Upload what you already have. We'll read it, then you check the dishes, prices and diet tags before anything is saved.</p>
      <label class="imp-drop" id="imp-drop"><input type="file" id="imp-file" accept=".pdf,.csv,.tsv,.txt,.xlsx,.xls,image/*" hidden>
        <b>📄 Choose a file</b><span class="muted small">PDF menu, photo of your menu, Excel or CSV</span></label>
      <div class="imp-or"><span>or paste it</span></div>
      <textarea id="imp-text" rows="7" placeholder="STARTERS&#10;Spring Rolls (V) ..... 8&#10;Crispy rolls with glass noodles&#10;&#10;MAINS&#10;Pad Thai - rice noodles, egg, peanuts  16"></textarea>
      <div class="row" style="margin-top:10px"><button class="btn" id="imp-read">Read my menu</button><button class="btn ghost" id="imp-cancel">Cancel</button><span class="muted small" id="imp-status" role="status"></span></div>
      <p class="small muted" style="margin:10px 0 0">Tip: (V), (VG), GF, “vegan”, “spicy” and 🌶 in your menu are turned into diet tags automatically.</p></div>
      <div id="imp-review"></div>`;
    const status = (t) => { document.getElementById('imp-status').textContent = t; };
    const back = () => { history.replaceState(null, '', '#menu-items'); route(); };
    document.getElementById('imp-cancel').onclick = back;
    const run = async (fn) => {
      const btn = document.getElementById('imp-read'); btn.disabled = true;
      try { rows = (await fn()).map((x) => ({ section: x.section || 'Menu', name: x.name, description: x.description || '', price: x.price || '', tags: x.tags || [], opts: TBMenuImport.optionsText(x.options || []) })); status(''); if (!rows.length) { status('We couldn’t find any dishes with prices. Try pasting the text, or a clearer photo.'); return; } review(); }
      catch (e) { status(''); fail(e); } finally { btn.disabled = false; }
    };
    const file = document.getElementById('imp-file');
    file.onchange = () => { const f = file.files[0]; if (f) { status(`Reading ${f.name}…`); run(() => readMenuFile(f, status)); } file.value = ''; };
    const drop = document.getElementById('imp-drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) { status(`Reading ${f.name}…`); run(() => readMenuFile(f, status)); } };
    document.getElementById('imp-read').onclick = () => {
      const t = document.getElementById('imp-text').value; if (!t.trim()) { status('Paste your menu or choose a file first.'); return; }
      run(() => smartRead(t, status));
    };

    if (preset && preset.items) { rows = preset.items.map((x) => ({ section: x.section || 'Menu', name: x.name, description: x.description || '', price: x.price || '', tags: x.tags || [], opts: TBMenuImport.optionsText(x.options || []) })); setTimeout(review, 0); }
    else if (preset && preset.pdf) {
      status('Getting the menu from your website…');
      run(async () => {
        const r = await fetch(`/api/admin/fetch-pdf?url=${encodeURIComponent(preset.pdf)}`, { credentials: 'same-origin' });
        if (!r.ok) { let m = 'Couldn’t get that menu.'; try { m = (await r.json()).error || m; } catch { /* */ } throw new Error(m); }
        return readMenuFile(new File([await r.blob()], 'menu.pdf', { type: 'application/pdf' }), status);
      });
    }

    function review() {
      const box = document.getElementById('imp-review');
      const secs = [...new Set(rows.map((r) => r.section))];
      box.innerHTML = `<div class="card" style="margin-top:16px"><div class="row"><h2 style="margin:0">Check ${rows.length} dish${rows.length === 1 ? '' : 'es'}</h2><span class="spacer"></span><span class="muted small">${secs.length} section${secs.length === 1 ? '' : 's'}</span></div>
        <p class="small muted">${preset ? 'From your website. ' : ''}Fix anything we read wrong. Sizes and add-ons go one group per line, like “Size: Small $9 | Large $14”. Remove rows you don't want. Nothing is saved until you press Import.</p>
        <div class="imp-list">${rows.map((r, i) => `<div class="imp-row" data-i="${i}">
          <div class="imp-top"><input data-k="name" value="${esc(r.name)}" aria-label="Dish name" placeholder="Dish name"><input data-k="price" value="${esc(r.price)}" inputmode="decimal" aria-label="Price" placeholder="Price" class="imp-price"><button class="btn ghost sm" data-rm aria-label="Remove ${esc(r.name)}">✕</button></div>
          <div class="imp-mid"><input data-k="section" value="${esc(r.section)}" list="imp-secs" aria-label="Section" class="imp-sec"><input data-k="description" value="${esc(r.description)}" aria-label="Description" placeholder="Description (optional)"></div>
          <details class="imp-opts" ${r.opts ? 'open' : ''}><summary>Sizes &amp; add-ons${r.opts ? ` (${r.opts.split('\n').length})` : ''}</summary><textarea data-k="opts" rows="2" aria-label="Sizes and add-ons for ${esc(r.name)}" placeholder="Size: Small $9 | Large $14&#10;Add-ons: Extra cheese +2 | Bacon +3">${esc(r.opts || '')}</textarea></details>
          <div class="imp-tags">${TBMatch.MENU_TAGS.map((t) => `<label class="dchip ${r.tags.includes(t.id) ? 'on' : ''}"><input type="checkbox" data-tag="${t.id}" ${r.tags.includes(t.id) ? 'checked' : ''}>${t.icon} ${esc(t.label)}</label>`).join('')}</div></div>`).join('')}</div>
        <datalist id="imp-secs">${secs.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        <div class="imp-actions">${existing ? `<label class="check"><input type="checkbox" id="imp-replace"> Replace my current menu (${existing} dish${existing === 1 ? '' : 'es'})</label>` : ''}
          <button class="btn lg" id="imp-go">Import ${rows.length} dish${rows.length === 1 ? '' : 'es'}</button></div></div>`;
      box.querySelectorAll('.imp-row').forEach((el) => {
        const r = rows[Number(el.dataset.i)];
        el.querySelectorAll('[data-k]').forEach((inp) => { inp.oninput = () => { r[inp.dataset.k] = inp.value; }; });
        el.querySelectorAll('[data-tag]').forEach((cb) => { cb.onchange = () => { cb.parentElement.classList.toggle('on', cb.checked); r.tags = cb.checked ? [...new Set([...r.tags, cb.dataset.tag])] : r.tags.filter((x) => x !== cb.dataset.tag); }; });
        el.querySelector('[data-rm]').onclick = () => { rows.splice(rows.indexOf(r), 1); review(); };
      });
      document.getElementById('imp-go').onclick = async (e) => {
        const items = rows.filter((r) => String(r.name).trim()).map(({ opts, ...r }) => ({ ...r, options: opts || '' })); if (!items.length) { TB.toast('No dishes to import.', true); return; }
        e.target.disabled = true;
        try {
          const rep = document.getElementById('imp-replace');
          const out = await api('/api/admin/menu/import', { body: { items, replace: !!(rep && rep.checked) } });
          TB.toast(`${out.imported} dishes added to your menu`); setupSteps().catch(() => {}); back();
        } catch (err) { e.target.disabled = false; fail(err); }
      };
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function menuItemModal(m, sections, section) {
    const v = m || { section: section || 'Starters', name: '', description: '', price_cents: null, tags: '', available: 1, options: '' };
    const has = new Set(v.tags.split(','));
    TB.modal(`<h2>${m ? `Edit ${esc(m.name)}` : 'Add a dish'}</h2><form id="mi-form">
      <div class="grid-2"><div class="field"><label for="mi-sec">Section</label><input id="mi-sec" name="section" list="mi-secs" value="${esc(v.section)}" required><datalist id="mi-secs">${[...new Set([...sections, 'Starters', 'Mains', 'Sides', 'Desserts', 'Drinks'])].map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div class="field"><label for="mi-price">Price</label><div class="money"><span>$</span><input id="mi-price" name="price" inputmode="decimal" value="${v.price_cents === null ? '' : (v.price_cents / 100).toFixed(2).replace(/\.00$/, '')}" placeholder="18"></div></div></div>
      <div class="field"><label for="mi-name">Dish name</label><input id="mi-name" name="name" value="${esc(v.name)}" required placeholder="e.g. Margherita pizza"></div>
      <div class="field"><label for="mi-desc">Description <span class="muted small">(optional)</span></label><textarea id="mi-desc" name="description" rows="2" placeholder="Ingredients, how it's made…">${esc(v.description)}</textarea></div>
      <div class="field"><label for="mi-opts">Sizes &amp; add-ons <span class="muted small">(optional, one group per line)</span></label><textarea id="mi-opts" name="options" rows="2" placeholder="Size: Small $9 | Large $14&#10;Add-ons: Extra cheese +2 | Bacon +3">${esc(TBMenuImport.optionsText(v.options || ''))}</textarea>
        <p class="small muted" style="margin:6px 0 0">Sizes show their full price. Add-ons show the extra charge, like +2.</p></div>
      <div class="field"><label>Dietary tags</label><div class="days">${TBMatch.MENU_TAGS.map((t) => `<label><input type="checkbox" data-mt="${t.id}" ${has.has(t.id) ? 'checked' : ''}>${t.icon} ${esc(t.label)}</label>`).join('')}</div>
        <p class="small muted" style="margin:6px 0 0">Vegan dishes are also counted as vegetarian and dairy-free.</p></div>
      <label class="check"><input type="checkbox" name="available" ${v.available ? 'checked' : ''}> Show on the menu</label>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit">${m ? 'Save' : 'Add dish'}</button>${m ? '' : '<button class="btn secondary" type="button" id="mi-another">Save & add another</button>'}<button class="btn ghost" type="button" data-close>Cancel</button></div></form>`,
    (box, close) => {
      const f = box.querySelector('#mi-form');
      box.querySelector('[data-mt="vegan"]').onchange = (e) => { if (e.target.checked) { box.querySelector('[data-mt="vegetarian"]').checked = true; box.querySelector('[data-mt="dairy_free"]').checked = true; } };
      const save = async (again) => {
        if (!f.reportValidity()) return;
        const d = TB.formData(f);
        const body = { section: d.section, name: d.name, description: d.description, price: d.price, available: d.available, options: d.options || '', tags: [...box.querySelectorAll('[data-mt]:checked')].map((x) => x.dataset.mt) };
        try {
          await api(m ? `/api/admin/menu/${m.id}` : '/api/admin/menu', { method: m ? 'PUT' : 'POST', body });
          TB.toast(m ? 'Dish saved' : `${d.name} added`);
          close(); viewMenu().catch(fail); setupSteps().catch(() => {});
          if (again) setTimeout(() => menuItemModal(null, [...new Set([...sections, d.section])], d.section), 50);
        } catch (e) { fail(e); }
      };
      f.onsubmit = (e) => { e.preventDefault(); save(false); };
      const another = box.querySelector('#mi-another'); if (another) another.onclick = () => save(true);
    });
  }

  // ---------------- In-page confirm / prompt (browser dialogs are blocked in some embeds) ----------------
  function ask(message, okLabel = 'Yes', danger = false) {
    return new Promise((resolve) => {
      let done = false;
      const close = TB.modal(`<h2>${esc(message)}</h2><div class="row" style="margin-top:12px"><button class="btn ${danger ? 'danger' : ''}" id="ask-ok">${esc(okLabel)}</button><button class="btn secondary" data-close>Cancel</button></div>`,
        (m, c) => { m.querySelector('#ask-ok').onclick = () => { done = true; c(); resolve(true); }; m.querySelector('#ask-ok').focus(); });
      const obs = new MutationObserver(() => { if (!document.body.contains(document.getElementById('ask-ok')) && !done) { done = true; obs.disconnect(); resolve(false); } });
      obs.observe(document.body, { childList: true });
      void close;
    });
  }
  function askText(title, value = '', placeholder = '') {
    return new Promise((resolve) => {
      let done = false;
      TB.modal(`<h2>${esc(title)}</h2><form id="askt"><input id="askt-v" value="${esc(value)}" placeholder="${esc(placeholder)}" required>
        <div class="row" style="margin-top:12px"><button class="btn" type="submit">Save</button><button class="btn secondary" type="button" data-close>Cancel</button></div></form>`,
      (m, c) => {
        const inp = m.querySelector('#askt-v'); inp.focus(); inp.select();
        m.querySelector('#askt').onsubmit = (e) => { e.preventDefault(); done = true; c(); resolve(inp.value.trim() || null); };
      });
      const obs = new MutationObserver(() => { if (!document.getElementById('askt') && !done) { done = true; obs.disconnect(); resolve(null); } });
      obs.observe(document.body, { childList: true });
    });
  }

  // ---------------- Seating helpers (a booking sits at one table or one combination) ----------------
  const seatVal = (x) => (x.combo_id ? `c${x.combo_id}` : x.table_id ? `t${x.table_id}` : '');
  const seatBody = (v) => (v && v[0] === 'c' ? { combo_id: Number(v.slice(1)), table_id: null } : v ? { table_id: Number(v.slice(1)), combo_id: null } : { table_id: null, combo_id: null });
  const comboTables = (c) => String(c.table_ids).split(',').map(Number);
  function seatOptions(sel, blankLabel = 'Unassigned') {
    const f = S.floor || { tables: [], combos: [] };
    const t = f.tables.filter((x) => x.active).map((x) => `<option value="t${x.id}"${sel === `t${x.id}` ? ' selected' : ''}>${esc(x.label)} (${x.min_seats}-${x.max_seats})</option>`).join('');
    const c = (f.combos || []).filter((x) => x.active).map((x) => `<option value="c${x.id}"${sel === `c${x.id}` ? ' selected' : ''}>${esc(x.name)} (${x.min_seats}-${x.max_seats})</option>`).join('');
    return `<option value="">${esc(blankLabel)}</option><optgroup label="Tables">${t}</optgroup>${c ? `<optgroup label="Combined tables">${c}</optgroup>` : ''}`;
  }
  async function withForce(fn, message) {
    try { return await fn(false); } catch (e) {
      if (e.status === 409 && await ask(`${e.message} ${message || 'Seat them there anyway?'}`, 'Yes, double-seat')) return fn(true);
      throw e;
    }
  }

  // ---------------- Reservations ----------------
  let refreshTimer = null;
  async function viewReservations() {
    view.innerHTML = `
      <div class="toolbar">
        <button class="btn secondary sm" id="d-prev" aria-label="Previous day">‹</button>
        <input type="date" id="d-date" value="${S.date}">
        <button class="btn secondary sm" id="d-next" aria-label="Next day">›</button>
        <button class="btn secondary sm" id="d-today">Today</button>
        <div class="seg" role="tablist"><button data-mode="list">List</button><button data-mode="floor">Floor plan</button><button data-mode="timeline">Timeline</button></div>
        <input type="search" id="d-q" placeholder="Search name, phone, code">
        <span class="live" id="live"><i></i>Live</span>
        <span class="spacer"></span>
        <button class="btn secondary" id="walkin">+ Walk-in</button>
        <button class="btn" id="newres">+ New reservation</button>
      </div>
      <div class="stats" id="stats"></div>
      <div id="upnext"></div>
      <div id="res-body"></div>`;
    const setDate = (d) => { S.date = d; document.getElementById('d-date').value = d; load(); };
    document.getElementById('d-prev').onclick = () => setDate(TB.addDays(S.date, -1));
    document.getElementById('d-next').onclick = () => setDate(TB.addDays(S.date, 1));
    document.getElementById('d-today').onclick = () => setDate(nowLocal().date);
    document.getElementById('d-date').onchange = (e) => setDate(e.target.value);
    let qt; document.getElementById('d-q').oninput = () => { clearTimeout(qt); qt = setTimeout(load, 200); };
    document.querySelectorAll('.seg button').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === S.mode);
      b.onclick = () => { S.mode = b.dataset.mode; try { localStorage.setItem('rb_mode', S.mode); } catch { /* */ } document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b)); load(); };
    });
    document.getElementById('newres').onclick = () => reservationModal(null, load);
    document.getElementById('walkin').onclick = () => walkInModal(load);
    clearInterval(refreshTimer);
    // Keep the book live: refresh every 30s while nobody is editing.
    refreshTimer = setInterval(() => {
      if (!document.getElementById('res-body')) { clearInterval(refreshTimer); return; }
      if (document.querySelector('.modal-back') || S.dragging) return;
      load(true).catch(() => {});
    }, 30000);
    await load();
  }

  async function load(quiet) {
    const qEl = document.getElementById('d-q');
    const q = qEl ? qEl.value : '';
    const [data, stats, floor] = await Promise.all([
      api(`/api/admin/reservations?date=${S.date}&q=${encodeURIComponent(q)}`),
      api(`/api/admin/stats?date=${S.date}`),
      api('/api/admin/floor'),
    ]);
    if (!document.getElementById('res-body')) return;
    S.floor = floor;
    const prev = S.lastStats;
    S.lastStats = stats;
    const tiles = [
      ['Reservations', data.reservations.filter((x) => x.status !== 'cancelled').length, 'bookings'],
      ['Covers', stats.covers || 0, 'covers'], ['Upcoming', stats.upcoming || 0, 'upcoming'], ['Seated', stats.seated || 0, 'seated'],
      ['Finished', stats.completed || 0, 'completed'], ['No-shows', stats.no_shows || 0, 'no_shows'], ['Cancelled', stats.cancelled || 0, 'cancelled'],
      ['Seats', stats.seats, 'seats'],
    ];
    document.getElementById('stats').innerHTML = tiles.map(([k, v, key]) =>
      `<div class="stat${quiet && prev && prev[key] !== stats[key] ? ' bump' : ''}"><b>${v}</b><span>${k}</span></div>`).join('');
    const live = document.getElementById('live');
    if (live) live.title = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    renderUpNext(data.reservations);
    const body = document.getElementById('res-body');
    if (S.mode === 'timeline') return renderTimeline(body, data.reservations, floor);
    if (S.mode === 'floor') return renderResFloor(body, data.reservations, floor);
    renderList(body, data.reservations);
  }

  function renderUpNext(rows) {
    const box = document.getElementById('upnext');
    const now = nowLocal();
    if (S.date !== now.date) { box.innerHTML = ''; return; }
    const soon = rows.filter((x) => x.status === 'confirmed' && toMin(x.time) <= now.minutes + 120 && toMin(x.time) >= now.minutes - 60)
      .sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6);
    if (!soon.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="upnext"><span class="upnext-title">Arriving next</span>${soon.map((x) => {
      const d = toMin(x.time) - now.minutes;
      const when = d > 0 ? `in ${d} min` : d === 0 ? 'now' : `${-d} min late`;
      return `<div class="arrival${d < -10 ? ' late' : ''}"><b>${TB.time(x.time)}</b> ${esc(x.guest_name)} · ${x.party_size}
        <span class="small muted">${esc(x.table_label || 'No table')} · ${when}</span><button class="btn ok sm" data-seat="${x.id}">Seat</button></div>`;
    }).join('')}</div>`;
    box.querySelectorAll('[data-seat]').forEach((b) => { b.onclick = () => resAction('seat', rows.find((x) => x.id === Number(b.dataset.seat))); });
  }

  function guestTags(x) {
    const h = x.history || {};
    const tags = [];
    (x.guest_tags || '').split(',').filter(Boolean).forEach((t) => tags.push(`<span class="tag ${/vip/i.test(t) ? 'vip' : /allerg/i.test(t) ? 'warn' : 'good'}">${esc(t)}</span>`));
    if (x.source) tags.push(`<span class="tag">${SOURCE_LABEL[x.source] || x.source}</span>`);
    if (x.occasion) tags.push(`<span class="tag good">${esc(x.occasion)}</span>`);
    if (h.visits > 0) tags.push(`<span class="tag good">${h.visits} visit${h.visits > 1 ? 's' : ''}</span>`);
    if (h.no_shows > 0) tags.push(`<span class="tag warn">${h.no_shows} no-show${h.no_shows > 1 ? 's' : ''}</span>`);
    return `<div class="guest-tags">${tags.join('')}</div>`;
  }

  // Reservation sections, in this order: Seated, Upcoming, Finished, then Cancelled / no-show last.
  const RES_GROUPS = [
    { id: 'seated', label: 'Seated', has: (x) => x.status === 'seated' },
    { id: 'upcoming', label: 'Upcoming', has: (x) => x.status === 'confirmed' },
    { id: 'finished', label: 'Finished', has: (x) => x.status === 'completed' },
    { id: 'off', label: 'Cancelled / no-show', has: (x) => ['cancelled', 'no_show'].includes(x.status) },
  ];
  /** Sections to show for the current filter, each sorted by time. */
  function resSections(rows) {
    const f = S.resFilter || 'all';
    return RES_GROUPS.filter((g) => f === 'all' || g.id === f)
      .map((g) => ({ ...g, rows: rows.filter(g.has).sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id) }))
      .filter((g) => g.rows.length);
  }
  function resFilterBar(rows, onChange) {
    const f = S.resFilter || 'all';
    const html = `<div class="chips res-filter" role="group" aria-label="Show reservations">${[{ id: 'all', label: 'All', n: rows.length }, ...RES_GROUPS.map((g) => ({ ...g, n: rows.filter(g.has).length }))]
      .map((g) => `<button type="button" class="chip ${f === g.id ? 'on' : ''}" data-rf="${g.id}" aria-pressed="${f === g.id}">${esc(g.label)} <span class="cnt">${g.n}</span></button>`).join('')}</div>`;
    const bind = (root) => root.querySelectorAll('[data-rf]').forEach((b) => { b.onclick = () => { S.resFilter = b.dataset.rf; onChange(); }; });
    return { html, bind };
  }

  function renderList(body, rows) {
    if (!rows.length) { body.innerHTML = `<div class="card"><p class="muted" style="margin:0">No reservations for ${TB.date(S.date, { weekday: 'long', month: 'long' })}. Use “+ New reservation” to add one.</p></div>`; return; }
    const now = nowLocal();
    const fb = resFilterBar(rows, () => renderList(body, rows));
    const secs = resSections(rows);
    body.innerHTML = `${fb.html}<div class="card" style="padding:0"><div class="table-wrap"><table class="data res-list">
      <thead><tr><th>Time</th><th>Guest</th><th>Party</th><th>Table</th><th>Status</th><th>Actions</th></tr></thead>
      ${secs.map((g) => `<tbody><tr class="res-sec"><th colspan="6">${esc(g.label)} <span class="muted">${g.rows.length} · ${g.rows.reduce((a, x) => a + x.party_size, 0)} guests</span></th></tr>${g.rows.map((x) => {
        const late = x.status === 'confirmed' && x.date === now.date && toMin(x.time) + 15 < now.minutes;
        const dim = ['cancelled', 'no_show', 'completed'].includes(x.status);
        return `<tr class="${dim ? 'dim' : ''}" data-id="${x.id}">
          <td class="time-cell">${TB.time(x.time)}${late ? '<br><span class="tag warn">Late</span>' : ''}</td>
          <td>${x.guest_id ? `<a href="#guests" class="guest-link" data-guest="${x.guest_id}"><b>${esc(x.guest_name)}</b></a>` : `<b>${esc(x.guest_name)}</b>`}<br><a href="tel:${esc(x.guest_phone)}">${esc(x.guest_phone)}</a> · <span class="muted">${esc(x.guest_email)}</span>
            ${guestTags(x)}${x.notes ? `<div class="small" style="margin-top:4px">📝 ${esc(x.notes)}</div>` : ''}${x.guest_notes ? `<div class="small muted">📇 ${esc(x.guest_notes)}</div>` : ''}${x.internal_notes ? `<div class="small muted">🔒 ${esc(x.internal_notes)}</div>` : ''}
            <div class="small muted">#${esc(x.code)}</div></td>
          <td class="party-cell" data-label="Party">${x.party_size}<span class="show-sm"> ${x.party_size === 1 ? 'guest' : 'guests'}</span></td>
          <td data-label="Table"><select data-act="table" ${dim ? 'disabled' : ''} style="min-width:130px" aria-label="Table">${seatOptions(seatVal(x))}</select></td>
          <td data-label="Status"><span class="badge ${x.status}">${STATUS_LABEL[x.status]}</span></td>
          <td><div class="res-actions">
            ${statusButtons(x, 'data-act')}
            ${x.guest_email !== 'walkin@guest.local' ? '<button class="btn ghost sm" data-act="resend" title="Resend email" aria-label="Resend email">✉️</button>' : ''}
          </div></td></tr>`;
      }).join('')}</tbody>`).join('') || '<tbody><tr><td colspan="6" class="muted">Nothing in this section.</td></tr></tbody>'}</table></div></div>`;
    fb.bind(body);
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const x = rows.find((r) => r.id === Number(tr.dataset.id));
      tr.querySelectorAll('[data-act]').forEach((el) => {
        const act = el.dataset.act;
        if (act === 'table') {
          el.onchange = () => withForce((force) => api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { ...seatBody(el.value), force } }))
            .then(() => { TB.toast('Table updated'); load(); }).catch((e) => { fail(e); load(); });
        } else el.onclick = () => resAction(act, x);
      });
    });
    body.querySelectorAll('.guest-link').forEach((a) => { a.onclick = (e) => { e.preventDefault(); S.openGuest = Number(a.dataset.guest); location.hash = 'guests'; }; });
  }

  // Status buttons for a reservation: Seat → Finished, or No-show / Cancel, and Undo. Big enough to tap on a phone.
  function statusButtons(x, attr, extra = '') {
    const b = (act, label, cls = 'secondary') => `<button class="btn ${cls} sm" ${attr}="${act}" ${extra}>${label}</button>`;
    if (x.status === 'confirmed') return b('seat', '✓ Seat', 'ok') + b('noshow', 'No-show') + b('cancel', 'Cancel') + b('edit', 'Edit');
    if (x.status === 'seated') return b('complete', '✓ Finished', 'ok') + b('undo', 'Undo seat') + b('cancel', 'Cancel') + b('edit', 'Edit');
    if (['no_show', 'completed'].includes(x.status)) return b('undo', 'Undo');
    return '';
  }
  async function resAction(act, x) {
    try {
      if (act === 'seat') { await api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { status: 'seated' } }); TB.toast(`${x.guest_name} seated`); }
      if (act === 'complete') { await api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { status: 'completed' } }); TB.toast(`${x.guest_name}'s table is finished`); }
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

  // Timeline: one row per table, bookings as bars. Drag a bar sideways to change the time
  // (snaps to 15 minutes) or up/down to move it to another table.
  function renderTimeline(body, rows, floor) {
    const active = rows.filter((x) => ['confirmed', 'seated', 'completed'].includes(x.status));
    let start = 10 * 60; let end = 23 * 60;
    active.forEach((x) => { start = Math.min(start, Math.floor(toMin(x.time) / 60) * 60); end = Math.max(end, toMin(x.time) + x.duration_minutes); });
    const span = end - start;
    const pct = (m) => `${((m - start) / span) * 100}%`;
    const tables = floor.tables.filter((t) => t.active);
    const combos = new Map((floor.combos || []).map((c) => [c.id, c]));
    const onTable = (t) => active.filter((x) => x.table_id === t.id || (x.combo_id && combos.has(x.combo_id) && comboTables(combos.get(x.combo_id)).includes(t.id)));
    const unassigned = active.filter((x) => !x.table_id && !x.combo_id);
    const now = nowLocal();
    const nowLine = now.date === S.date && now.minutes > start && now.minutes < end ? `<div class="tl-now" style="left:${pct(now.minutes)}"></div>` : '';
    const lines = []; for (let m = start; m <= end; m += 60) lines.push(m);
    const row = (seat, label, sub, items) => `<div class="tl-row" data-seat="${seat}"><div class="tl-label">${esc(label)}<small>${sub}</small></div><div class="tl-track">
      ${lines.map((m) => `<div class="tl-line" style="left:${pct(m)}"></div>`).join('')}${nowLine}
      ${items.map((x) => `<div class="tl-bar ${x.status}${x.combo_id ? ' combo' : ''}" data-id="${x.id}" style="left:${pct(toMin(x.time))};width:calc(${(x.duration_minutes / span) * 100}% - 2px)" title="${esc(x.guest_name)} · ${x.party_size} · ${TB.time(x.time)}${x.combo_id ? ` · ${esc(x.table_label || '')}` : ''}">
        <b>${esc(x.guest_name)}</b> (${x.party_size})<br>${TB.time(x.time)}${x.combo_id ? ' · ⛓' : ''}</div>`).join('')}</div></div>`;
    body.innerHTML = `<div class="timeline"><div class="tl-grid">
      <div class="tl-hours"><div class="tl-label"></div><div class="tl-track">${lines.map((m) => `<span style="left:${pct(m)}">${TB.time(hhmm(m)).replace(':00', '')}</span>`).join('')}</div></div>
      ${tables.map((t) => row(`t${t.id}`, t.label, `${t.min_seats}-${t.max_seats} seats`, onTable(t))).join('')}
      ${row('', 'Unassigned', `${unassigned.length}`, unassigned)}
    </div></div>
    <div class="legend"><span><i style="background:#2563eb;border-color:#2563eb"></i>Booked</span><span><i style="background:#16a34a;border-color:#16a34a"></i>Seated</span><span><i style="background:#9ca3af;border-color:#9ca3af"></i>Completed</span><span>⛓ Combined tables</span><span><b>Drag</b> a booking to change its time or table. Click to edit.</span></div>`;

    body.querySelectorAll('.tl-bar').forEach((bar) => {
      const x = rows.find((r) => r.id === Number(bar.dataset.id));
      let sx; let sy; let moved = false; let track; let ghostTime = x.time;
      bar.addEventListener('pointerdown', (e) => {
        if (x.status === 'completed') return;
        bar.setPointerCapture(e.pointerId); sx = e.clientX; sy = e.clientY; moved = false; track = bar.parentElement; S.dragging = true;
      });
      bar.addEventListener('pointermove', (e) => {
        if (sx === undefined) return;
        const dx = e.clientX - sx; const dy = e.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true; bar.classList.add('dragging');
        const deltaMin = Math.round(((dx / track.clientWidth) * span) / 15) * 15;
        ghostTime = hhmm(Math.max(0, Math.min(23 * 60 + 45, toMin(x.time) + deltaMin)));
        bar.style.transform = `translate(${dx}px, ${dy}px)`;
        bar.querySelector('br').nextSibling.textContent = `${TB.time(ghostTime)} `;
        body.querySelectorAll('.tl-row').forEach((r) => r.classList.remove('drop'));
        const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.classList && el.classList.contains('tl-row'));
        if (under) under.classList.add('drop');
      });
      bar.addEventListener('pointerup', async (e) => {
        if (sx === undefined) return;
        sx = undefined; S.dragging = false;
        if (!moved) { reservationModal(x, load); return; }
        const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.classList && el.classList.contains('tl-row'));
        const seat = under ? under.dataset.seat : seatVal(x);
        const fromSeat = bar.closest('.tl-row').dataset.seat;
        const patch = {};
        if (ghostTime !== x.time) patch.time = ghostTime;
        if (seat !== fromSeat) Object.assign(patch, seatBody(seat));
        if (!Object.keys(patch).length) { load(); return; }
        try {
          await withForce((force) => api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { ...patch, force, notify: true } }));
          TB.toast(`Moved ${x.guest_name} to ${TB.time(patch.time || x.time)}${seat !== fromSeat ? ` · ${seat ? (under.querySelector('.tl-label').firstChild.textContent) : 'Unassigned'}` : ''}`);
        } catch (err) { fail(err); }
        load();
      });
    });
  }

  // Floor view of the book: every table on the floor plan, colored by what's happening at the
  // chosen time. Click a table to see who's there now, who's next, and the rest of its night.
  function renderResFloor(body, rows, floor) {
    const now = nowLocal();
    const isToday = S.date === now.date;
    // Tables show who's there right now (today) or their first booking (other days). No time slider.
    S.rfTime = isToday ? hhmm(now.minutes) : '00:00';
    const areas = floor.areas.slice();
    if (floor.tables.some((t) => !t.area_id)) areas.push({ id: 0, name: 'Unassigned' });
    if (S.rfArea === undefined || !areas.some((a) => a.id === S.rfArea)) S.rfArea = areas.length ? areas[0].id : 0;
    const combos = new Map((floor.combos || []).map((c) => [c.id, c]));
    const live = rows.filter((x) => ['confirmed', 'seated', 'completed'].includes(x.status));
    const seatsOf = (x) => (x.combo_id && combos.has(x.combo_id) ? comboTables(combos.get(x.combo_id)) : x.table_id ? [x.table_id] : []);
    const at = (t) => live.filter((x) => seatsOf(x).includes(t.id)).sort((a, b) => a.time.localeCompare(b.time));
    const t0 = toMin(S.rfTime);
    const state = (t) => {
      const list = at(t);
      const cur = list.find((x) => x.status !== 'completed' && toMin(x.time) <= t0 && toMin(x.time) + x.duration_minutes > t0);
      const next = list.find((x) => x.status === 'confirmed' && toMin(x.time) > t0 && x !== cur);
      return { list, cur, next };
    };
    const until = (x) => TB.time(hhmm(toMin(x.time) + x.duration_minutes));
    const inMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
    const len = (m) => (m % 60 ? `${Math.floor(m / 60) ? `${Math.floor(m / 60)} h ` : ''}${m % 60} min` : `${m / 60} h`);
    const tables = floor.tables.filter((t) => t.active && (S.rfArea ? t.area_id === S.rfArea : !t.area_id));
    const sel = S.rfSel || [];
    const free = floor.tables.filter((t) => t.active && !state(t).cur).length;
    const covers = live.filter((x) => x.status !== 'completed' && toMin(x.time) <= t0 && toMin(x.time) + x.duration_minutes > t0).reduce((a, x) => a + x.party_size, 0);
    body.innerHTML = `<div class="rf-bar">
        <div class="seg" id="rf-areas">${areas.map((a) => `<button data-a="${a.id}" class="${a.id === S.rfArea ? 'on' : ''}">${esc(a.name)}</button>`).join('')}</div>
        <span class="muted small"><b>${free}</b> free tables · <b>${covers}</b> guests in house</span>
        <span class="spacer"></span>
        <button class="btn ${S.rfCombine ? '' : 'secondary'} sm" id="rf-combine">⛓ ${S.rfCombine ? 'Done combining' : 'Combine tables'}</button>
      </div>
      ${S.rfCombine ? `<div class="alert rf-combine-bar"><span>${sel.length ? `<b>${sel.map((id) => esc((floor.tables.find((t) => t.id === id) || {}).label)).join(' + ')}</b> · up to ${sel.reduce((a, id) => a + ((floor.tables.find((t) => t.id === id) || {}).max_seats || 0), 0)} seats` : 'Tap the tables you push together for big parties.'}</span>
        <span class="spacer"></span><button class="btn sm" id="rf-make" ${sel.length < 2 ? 'disabled' : ''}>Create combination</button><button class="btn ghost sm" id="rf-clear">Clear</button></div>` : ''}
      <div class="floor-wrap rf-wrap">
        <div><div class="canvas-scroll"><div class="canvas rf" id="rf-canvas">${tables.map((t) => {
          const [w, h] = tableSize(t); const st = state(t);
          const cls = st.cur ? `busy-${st.cur.status}` : st.next && toMin(st.next.time) - t0 <= 30 ? 'soon' : '';
          const line = st.cur ? `${esc(st.cur.guest_name.split(' ')[0])} · ${st.cur.party_size}<br>until ${until(st.cur)}` : st.next ? `Next ${TB.time(st.next.time)}<br>${esc(st.next.guest_name.split(' ')[0])} · ${st.next.party_size}` : 'Free';
          const inCombo = st.cur && st.cur.combo_id ? '<span class="rf-link">⛓</span>' : '';
          return `<div class="ftable ${t.shape} ${cls} ${S.rfTable === t.id ? 'sel' : ''} ${sel.includes(t.id) ? 'combo-hl' : ''}" data-id="${t.id}"
            style="left:${t.x}px;top:${t.y}px;width:${w}px;height:${h}px;transform:rotate(${t.rotation}deg)">${inCombo}
            <div>${esc(t.label)}<small class="rf-line">${line}</small></div>${chairs(t, w, h)}</div>`;
        }).join('') || '<p class="muted" style="padding:20px">No tables in this room.</p>'}</div></div>
        <div class="legend"><span><i></i>Free</span><span><i style="background:#fef3c7;border-color:#d97706"></i>Arriving within 30 min</span><span><i style="background:#dbeafe;border-color:#2563eb"></i>Booked</span><span><i style="background:#dcfce7;border-color:#16a34a"></i>Seated</span><span>⛓ Combined tables</span></div></div>
        <div class="card" id="rf-panel"></div>
      </div>`;

    const panel = () => {
      const p = document.getElementById('rf-panel');
      const t = floor.tables.find((z) => z.id === S.rfTable);
      if (!t) {
        const today = rows;
        const movable = (x) => ['confirmed', 'seated'].includes(x.status);
        const fb = resFilterBar(rows, () => renderResFloor(body, rows, floor));
        const seatLabel = (x) => (x.combo_id ? (combos.get(x.combo_id) || {}).name : (floor.tables.find((z) => z.id === x.table_id) || {}).label) || '';
        p.innerHTML = `<div class="row"><h2 style="margin:0">All reservations</h2><span class="spacer"></span><span class="muted small">${today.length} · ${today.filter(movable).reduce((a, x) => a + x.party_size, 0)} guests</span></div>
          <p class="muted small" style="margin:4px 0 10px">Tap a name, then tap a table to move it. Or press and drag it onto a table.</p>
          ${fb.html}<div class="rf-list">${resSections(today).map((g) => `<div class="rf-sec">${esc(g.label)} <span>${g.rows.length}</span></div>${g.rows.map((x) => `<button type="button" class="rf-item ${x.status} ${S.rfMove === x.id ? 'moving' : ''} ${movable(x) ? '' : 'done'}" data-x="${x.id}" aria-pressed="${S.rfMove === x.id}">
            <span class="rf-at">${TB.time(x.time)}</span>
            <span class="rf-item-main"><b>${esc(x.guest_name)}</b><span class="small muted">${x.party_size} ${x.party_size === 1 ? 'guest' : 'guests'}${x.status === 'confirmed' ? '' : ` · ${STATUS_LABEL[x.status]}`}</span></span>
            <span class="rf-tbl ${seatLabel(x) ? '' : 'none'}">${seatLabel(x) ? esc(seatLabel(x)) : 'No table'}</span></button>`).join('')}`).join('') || '<p class="muted small">No reservations here.</p>'}</div>
          <div class="rf-len"><h3 class="rf-h">Reservation length</h3><p class="small muted" style="margin:0">${turnSummary()} <a href="#services">Change</a></p></div>`;
        fb.bind(p);
        p.querySelectorAll('.rf-item').forEach((el) => {
          const x = rows.find((r) => r.id === Number(el.dataset.x));
          if (!movable(x)) { el.onclick = () => resAction('edit', x); return; }
          el.onclick = () => { if (el.dataset.dragged) return; S.rfMove = S.rfMove === x.id ? null : x.id; renderResFloor(body, rows, floor); };
          el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') dragRes(e, x, el); });
          longPressDrag(el, x);
        });
        const sel0 = p.querySelector('.rf-item.moving'); if (sel0) sel0.scrollIntoView({ block: 'nearest' });
        return;
      }
      const st = state(t);
      const area = (floor.areas.find((a) => a.id === t.area_id) || { name: 'Unassigned' }).name;
      const joins = (floor.combos || []).filter((c) => c.active && comboTables(c).includes(t.id));
      const card = (x, kind) => `<div class="rf-res ${x.status}">
        <div class="row" style="gap:6px"><span class="badge ${x.status}">${kind}</span><b>${TB.time(x.time)}–${until(x)}</b><span class="muted small">${len(x.duration_minutes)}</span></div>
        <div class="rf-guest">${esc(x.guest_name)} · ${x.party_size} ${x.party_size === 1 ? 'guest' : 'guests'}</div>
        ${x.combo_id ? `<div class="small">⛓ ${esc(x.table_label || '')}</div>` : ''}
        ${guestTags(x)}${x.notes ? `<div class="small">📝 ${esc(x.notes)}</div>` : ''}${x.guest_notes ? `<div class="small muted">📇 ${esc(x.guest_notes)}</div>` : ''}
        <div class="res-actions" style="margin-top:8px">
          ${statusButtons(x, 'data-a', `data-x="${x.id}"`)}<button class="btn secondary sm" data-mv="${x.id}">Move table</button></div></div>`;
      const nextIn = st.next ? toMin(st.next.time) - t0 : null;
      const later = st.list.filter((x) => x !== st.cur && x !== st.next && toMin(x.time) > t0);
      p.innerHTML = `<div class="row"><h2 style="margin:0">Table ${esc(t.label)}</h2><span class="spacer"></span><button class="btn ghost sm" id="rf-x" aria-label="Close">✕</button></div>
        <p class="muted small" style="margin:4px 0 12px">${t.min_seats}-${t.max_seats} seats · ${esc(area)}${t.online_bookable ? '' : ' · staff only'}</p>
        ${isToday ? `<h3 class="rf-h">Right now</h3>${st.cur ? card(st.cur, st.cur.status === 'seated' ? 'Seated' : 'Booked') : '<p class="rf-free">Free</p>'}` : ''}
        <h3 class="rf-h">Next reservation</h3>${st.next ? `<p class="rf-when">${TB.time(st.next.time)} <span class="muted">· in ${inMin(nextIn)}</span></p>${card(st.next, 'Next')}` : '<p class="muted small">Nothing else booked on this table today.</p>'}
        ${later.length ? `<h3 class="rf-h">Later</h3>${later.map((x) => `<div class="rf-later"><b>${TB.time(x.time)}</b> ${esc(x.guest_name)} · ${x.party_size}</div>`).join('')}` : ''}
        ${joins.length ? `<h3 class="rf-h">Combines with</h3>${joins.map((c) => `<div class="rf-later">⛓ <b>${esc(c.name)}</b> · ${c.min_seats}-${c.max_seats} seats</div>`).join('')}` : ''}
        <div class="row" style="margin-top:14px"><button class="btn sm" id="rf-book">+ Book this table</button><button class="btn secondary sm" id="rf-walk">Seat walk-in here</button></div>`;
      p.querySelector('#rf-x').onclick = () => { S.rfTable = null; renderResFloor(body, rows, floor); };
      p.querySelectorAll('[data-mv]').forEach((b) => { b.onclick = () => { S.rfMove = Number(b.dataset.mv); S.rfTable = null; renderResFloor(body, rows, floor); }; });
      p.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => resAction(b.dataset.a, rows.find((x) => x.id === Number(b.dataset.x))); });
      p.querySelector('#rf-book').onclick = () => reservationModal(null, load, { table_id: t.id, time: S.rfTime, party_size: Math.max(t.min_seats, Math.min(2, t.max_seats)) });
      p.querySelector('#rf-walk').onclick = () => walkInModal(load, `t${t.id}`);
    };
    panel();

    body.querySelectorAll('#rf-areas button').forEach((b) => { b.onclick = () => { S.rfArea = Number(b.dataset.a); S.rfTable = null; renderResFloor(body, rows, floor); }; });
    document.getElementById('rf-combine').onclick = () => { S.rfCombine = !S.rfCombine; S.rfSel = []; renderResFloor(body, rows, floor); };
    if (S.rfCombine) {
      document.getElementById('rf-clear').onclick = () => { S.rfSel = []; renderResFloor(body, rows, floor); };
      document.getElementById('rf-make').onclick = async () => {
        try {
          const c = await api('/api/admin/combos', { body: { table_ids: S.rfSel } });
          TB.toast(`Combined ${c.name}: parties of ${c.min_seats}-${c.max_seats} are seated here automatically`);
          S.rfSel = []; S.rfCombine = false; load();
        } catch (e) { fail(e); }
      };
    }
    // On small screens, shrink the room to fit the width so every table is visible without scrolling sideways.
    const cv = document.getElementById('rf-canvas');
    if (cv && tables.length) {
      const wBox = Math.max(...tables.map((t) => t.x + tableSize(t)[0])) + 40;
      const hBox = Math.max(...tables.map((t) => t.y + tableSize(t)[1])) + 40;
      const avail = cv.parentElement.clientWidth - 2;
      const k = Math.min(1, avail / Math.max(wBox, 300));
      cv.style.width = `${Math.max(wBox, k < 1 ? 0 : 900)}px`;
      cv.style.height = `${Math.max(hBox, k < 1 ? 0 : 400)}px`;
      cv.style.zoom = k < 1 ? String(k) : '';
    }
    const moveTo = (x, tableId) => {
      S.rfMove = null;
      if (!x || seatVal(x) === `t${tableId}`) { renderResFloor(body, rows, floor); return; }
      const t = floor.tables.find((z) => z.id === tableId);
      withForce((force) => api(`/api/admin/reservations/${x.id}`, { method: 'PATCH', body: { ...seatBody(`t${tableId}`), force } }))
        .then(() => { TB.toast(`${x.guest_name} moved to table ${t ? t.label : ''}`); load(); }).catch((e) => { fail(e); load(); });
    };
    // Drag a reservation (from the list, or off a table with a mouse) and drop it on a table. Works with touch and mouse.
    function dragRes(e, x, src) {
      if (!x || S.rfCombine) return;
      const sx = e.clientX; const sy = e.clientY; let ghost = null; let over = null; let raf = null;
      const tableAt = (cx, cy) => { const el = document.elementFromPoint(cx, cy); return el && el.closest('#rf-canvas .ftable'); };
      const move = (ev) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          ghost = document.createElement('div'); ghost.className = 'rf-ghost'; ghost.textContent = `${TB.time(x.time)} ${x.guest_name} · ${x.party_size}`;
          document.body.appendChild(ghost); src.classList.add('dragging'); document.body.classList.add('rf-dragging');
        }
        ev.preventDefault();
        ghost.style.left = `${ev.clientX + 12}px`; ghost.style.top = `${ev.clientY + 12}px`;
        const hover = () => { const t = tableAt(ev.clientX, ev.clientY); if (t !== over) { if (over) over.classList.remove('drop-hl'); over = t; if (over) over.classList.add('drop-hl'); } };
        hover();
        // Scroll the page when dragging near the top or bottom edge, and keep the highlighted table in step.
        cancelAnimationFrame(raf);
        const edge = ev.clientY < 50 ? -10 : ev.clientY > innerHeight - 50 ? 10 : 0;
        if (edge) { const step = () => { const y = scrollY; window.scrollBy(0, edge); if (scrollY === y) return; hover(); raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); }
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        cancelAnimationFrame(raf);
        if (!ghost) return;
        ghost.remove(); src.classList.remove('dragging'); document.body.classList.remove('rf-dragging');
        if (over) over.classList.remove('drop-hl');
        src.dataset.dragged = '1'; setTimeout(() => { delete src.dataset.dragged; }, 50);
        const t = ev.type === 'pointerup' ? (tableAt(ev.clientX, ev.clientY) || over) : null;
        if (t) moveTo(x, Number(t.dataset.id));
      };
      document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    }
    // Phones and tablets: press and hold a name for a moment, then drag it onto a table. A quick swipe still scrolls.
    function longPressDrag(el, x) {
      el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1 || S.rfCombine) return;
        const t0 = e.touches[0]; const sx = t0.clientX; const sy = t0.clientY; let live = false; let ghost = null; let over = null; let raf = null;
        const tableAt = (cx, cy) => { const z = document.elementFromPoint(cx, cy); return z && z.closest('#rf-canvas .ftable'); };
        const timer = setTimeout(() => {
          live = true; if (navigator.vibrate) navigator.vibrate(15);
          ghost = document.createElement('div'); ghost.className = 'rf-ghost'; ghost.textContent = `${TB.time(x.time)} ${x.guest_name} · ${x.party_size}`;
          ghost.style.left = `${sx + 12}px`; ghost.style.top = `${sy - 40}px`; document.body.appendChild(ghost); el.classList.add('dragging');
        }, 280);
        const move = (ev) => {
          const p0 = ev.touches[0];
          if (!live) { if (Math.hypot(p0.clientX - sx, p0.clientY - sy) > 8) end(); return; }
          ev.preventDefault();
          ghost.style.left = `${p0.clientX + 12}px`; ghost.style.top = `${p0.clientY - 40}px`;
          const hover = () => { const t = tableAt(p0.clientX, p0.clientY); if (t !== over) { if (over) over.classList.remove('drop-hl'); over = t; if (over) over.classList.add('drop-hl'); } };
          hover();
          cancelAnimationFrame(raf);
          const edge = p0.clientY < 80 ? -12 : p0.clientY > innerHeight - 80 ? 12 : 0;
          if (edge) { const step = () => { const y = scrollY; window.scrollBy(0, edge); if (scrollY === y) return; hover(); raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); }
        };
        const end = (ev) => {
          clearTimeout(timer); cancelAnimationFrame(raf);
          document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', end);
          if (!live) return;
          if (ev && ev.cancelable) ev.preventDefault();
          ghost.remove(); el.classList.remove('dragging'); if (over) over.classList.remove('drop-hl');
          el.dataset.dragged = '1'; setTimeout(() => { delete el.dataset.dragged; }, 400);
          if (over && ev && ev.type === 'touchend') moveTo(x, Number(over.dataset.id));
        };
        document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
      }, { passive: true });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    if (S.rfMove) {
      const mx = rows.find((r) => r.id === S.rfMove);
      if (mx) body.querySelector('.floor-wrap').insertAdjacentHTML('beforebegin', `<div class="alert rf-move-bar"><span>Tap a table for <b>${esc(mx.guest_name)} · ${mx.party_size}</b></span><span class="spacer"></span><button class="btn ghost sm" id="rf-move-x">Cancel</button></div>`);
      const mb = document.getElementById('rf-move-x'); if (mb) mb.onclick = () => { S.rfMove = null; renderResFloor(body, rows, floor); };

    }
    body.querySelectorAll('#rf-canvas .ftable').forEach((el) => {
      const st = state(floor.tables.find((z) => z.id === Number(el.dataset.id)));
      const who = st.cur || st.next;
      if (who) el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') dragRes(e, who, el); });
      el.onclick = () => {
        if (el.dataset.dragged) return;
        const id = Number(el.dataset.id);
        if (S.rfMove) { moveTo(rows.find((r) => r.id === S.rfMove), id); return; }
        if (S.rfCombine) { S.rfSel = sel.includes(id) ? sel.filter((z) => z !== id) : [...sel, id]; }
        else S.rfTable = S.rfTable === id ? null : id;
        renderResFloor(body, rows, floor);
        if (!S.rfCombine && S.rfTable && window.innerWidth < 1100) {
          const pn = document.getElementById('rf-panel'); if (pn) pn.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
    });
  }

  function turnSummary() {
    const rows = TBMatch.parseTurns(S.me.restaurant.turn_times);
    if (!rows.length) return 'Each service uses its own turn time.';
    const h = (m) => (m % 60 ? `${(m / 60).toFixed(1).replace('.0', '')} h` : `${m / 60} h`);
    let lo = 1;
    return rows.map((r, i) => { const s = i === rows.length - 1 && r.max >= 20 ? `${lo}+ guests` : lo === r.max ? `${r.max} guest${r.max > 1 ? 's' : ''}` : `${lo}-${r.max} guests`; lo = r.max + 1; return `${s}: ${h(r.minutes)}`; }).join(' · ');
  }

  async function guestBook() {
    if (!S.guests) { try { S.guests = (await api('/api/admin/guests')).guests; } catch { S.guests = []; } }
    return S.guests;
  }

  function reservationModal(x, done, prefill) {
    const isNew = !x;
    const v = x || { date: S.date, time: '19:00', party_size: 2, guest_name: '', guest_email: '', guest_phone: '', notes: '', internal_notes: '', occasion: '', duration_minutes: 0, ...(prefill || {}) };
    if (!v.duration_minutes) v.duration_minutes = TBMatch.turnFor(S.me.restaurant.turn_times, Number(v.party_size), 90);
    TB.modal(`<h2>${isNew ? 'New reservation' : `Edit reservation #${esc(v.code)}`}</h2>
      <form id="m-form">
        <div class="grid-3">
          <div class="field"><label for="m-date">Date</label><input id="m-date" type="date" name="date" value="${v.date}" required></div>
          <div class="field"><label for="m-party">Party</label><input id="m-party" type="number" name="party_size" min="1" max="50" value="${v.party_size}" required></div>
          <div class="field"><label for="m-dur">Length (min) <span class="muted small" id="m-durhint"></span></label><input id="m-dur" type="number" name="duration_minutes" min="15" step="15" value="${v.duration_minutes}"></div>
        </div>
        <div class="field"><label>Time</label><div id="m-slots" class="slots"></div><input type="hidden" name="time" value="${v.time}"></div>
        <div class="field"><label for="m-seat">Table</label><select id="m-seat" name="seat">${seatOptions(seatVal(v), 'Auto-assign best table')}</select></div>
        <div class="field"><label for="m-name">Guest name ${isNew ? '<span class="muted small">(type to search your address book)</span>' : ''}</label><input id="m-name" name="name" list="m-guests" autocomplete="off" value="${esc(v.guest_name)}" required><datalist id="m-guests"></datalist></div>
        <div class="grid-2">
          <div class="field"><label for="m-phone">Phone</label><input id="m-phone" name="phone" type="tel" value="${esc(v.guest_phone)}" required></div>
          <div class="field"><label for="m-email">Email</label><input id="m-email" name="email" type="email" value="${esc(v.guest_email)}" required></div>
        </div>
        <div id="m-guestnote"></div>
        <div class="grid-2">
          <div class="field"><label for="m-occ">Occasion</label><input id="m-occ" name="occasion" value="${esc(v.occasion)}"></div>
          ${isNew ? '<div class="field"><label for="m-src">Booked via</label><select id="m-src" name="source"><option value="phone">Phone</option><option value="admin">In person / staff</option></select></div>' : '<div></div>'}
        </div>
        <div class="field"><label for="m-notes">Guest requests</label><textarea id="m-notes" name="notes">${esc(v.notes)}</textarea></div>
        <div class="field"><label for="m-int">Internal notes (staff only)</label><textarea id="m-int" name="internal_notes">${esc(v.internal_notes)}</textarea></div>
        <label class="check"><input type="checkbox" name="notify" checked> Email the guest ${isNew ? 'a confirmation' : 'if date/time/party changes'}</label>
        <div class="row" style="margin-top:16px"><button class="btn" type="submit">${isNew ? 'Book' : 'Save'}</button><button class="btn secondary" type="button" data-close>Close</button></div>
      </form>`,
    (m, close) => {
      const f = m.querySelector('#m-form');
      // Address book lookup
      guestBook().then((guests) => {
        m.querySelector('#m-guests').innerHTML = guests.map((g) => `<option value="${esc(g.name)}">${esc([g.phone, g.email].filter(Boolean).join(' · '))}</option>`).join('');
        const fill = () => {
          const g = guests.find((z) => z.name.toLowerCase() === f.name.value.trim().toLowerCase());
          const box = m.querySelector('#m-guestnote');
          if (!g) { box.innerHTML = ''; return; }
          if (isNew) { if (!f.phone.value) f.phone.value = g.phone || ''; if (!f.email.value) f.email.value = g.email || ''; }
          box.innerHTML = (g.tags || g.notes) ? `<div class="alert" style="margin-bottom:12px">📇 ${g.tags ? `<b>${esc(g.tags.split(',').join(', '))}</b> ` : ''}${esc(g.notes || '')}</div>` : '';
        };
        f.name.addEventListener('input', fill); f.name.addEventListener('change', fill); fill();
      });
      const loadSlots = async () => {
        const av = await api(`/api/admin/availability?date=${f.date.value}&party=${f.party_size.value}&ignore=${isNew ? 0 : v.id}`);
        const box = m.querySelector('#m-slots');
        const times = av.slots.slice();
        if (!times.some((s) => s.time === f.time.value)) times.push({ time: f.time.value, available: false, custom: true });
        times.sort((a, b) => a.time.localeCompare(b.time));
        box.innerHTML = times.map((s) => `<button type="button" class="slot ${s.available ? '' : 'off'} ${s.time === f.time.value ? 'selected' : ''}" style="text-decoration:none;cursor:pointer" data-t="${s.time}" title="${s.available ? (s.comboId ? 'Free with combined tables' : 'Table available') : 'No free table (you can still pick a table manually)'}">${TB.time(s.time)}${s.comboId ? ' ⛓' : ''}</button>`).join('')
          + '<input type="time" step="300" style="width:130px" aria-label="Custom time">';
        box.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { f.time.value = b.dataset.t; box.querySelectorAll('.slot').forEach((z) => z.classList.toggle('selected', z === b)); }; });
        box.querySelector('input[type=time]').onchange = (e) => { if (e.target.value) { f.time.value = e.target.value; loadSlots(); } };
      };
      // Length follows party size (Services & hours › Reservation length) until staff type their own.
      let durTouched = !isNew;
      f.duration_minutes.oninput = () => { durTouched = true; };
      const syncDur = () => {
        const auto = TBMatch.turnFor(S.me.restaurant.turn_times, Number(f.party_size.value) || 1, 90);
        if (!durTouched) f.duration_minutes.value = auto;
        m.querySelector('#m-durhint').textContent = `auto ${auto}`;
      };
      syncDur();
      f.date.onchange = loadSlots; f.party_size.onchange = () => { syncDur(); loadSlots(); }; f.party_size.oninput = syncDur; loadSlots().catch(fail);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const d = TB.formData(f);
        const body = {
          date: d.date, time: d.time, party_size: Number(d.party_size), duration_minutes: Number(d.duration_minutes) || 90,
          ...seatBody(d.seat), notes: d.notes, internal_notes: d.internal_notes, occasion: d.occasion,
        };
        const send = (force) => (isNew
          ? api('/api/admin/reservations', { body: { ...body, name: d.name, phone: d.phone, email: d.email, source: d.source, send_email: d.notify, force } })
          : api(`/api/admin/reservations/${v.id}`, { method: 'PATCH', body: { ...body, guest_name: d.name, guest_phone: d.phone, guest_email: d.email, notify: d.notify, force } }));
        try { await withForce(send, 'Book it there anyway (double-seat)?'); } catch (err) { return fail(err); }
        S.guests = null;
        close(); TB.toast(isNew ? 'Reservation booked' : 'Reservation updated'); done && done();
      };
    });
  }

  function walkInModal(done, seat = '') {
    TB.modal(`<h2>Seat a walk-in</h2><form id="w-form">
      <div class="grid-2"><div class="field"><label for="w-party">Party size</label><input id="w-party" type="number" name="party_size" min="1" value="2"></div>
      <div class="field"><label for="w-seat">Table</label><select id="w-seat" name="seat">${seatOptions(seat, 'Auto-assign')}</select></div></div>
      <div class="grid-2"><div class="field"><label for="w-name">Name (optional)</label><input id="w-name" name="name"></div><div class="field"><label for="w-phone">Phone (optional)</label><input id="w-phone" name="phone" type="tel"></div></div>
      <div class="row"><button class="btn ok" type="submit">Seat now</button><button class="btn secondary" type="button" data-close>Close</button></div></form>`,
    (m, close) => {
      m.querySelector('#w-form').onsubmit = async (e) => {
        e.preventDefault();
        const d = TB.formData(e.target);
        const now = nowLocal();
        const body = { source: 'walk_in', party_size: Number(d.party_size), name: d.name, phone: d.phone, date: now.date, time: hhmm(Math.floor(now.minutes / 5) * 5), ...seatBody(d.seat) };
        try { await withForce((force) => api('/api/admin/reservations', { body: { ...body, force } }), 'Seat them there anyway?'); } catch (err) { return fail(err); }
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
          <div class="card" id="combos" style="margin-top:16px"></div>
        </div>
        <div class="card" id="tpanel"><p class="muted" style="margin:0">Select a table to edit its seats, shape and settings, or add a new one.</p></div>
      </div>`;
    const canvas = document.getElementById('canvas');
    const t0 = toMin(S.floorTime);
    const comboById = new Map((floor.combos || []).map((c) => [c.id, c]));
    const busy = (t) => resv.find((x) => (x.table_id === t.id || (x.combo_id && comboById.has(x.combo_id) && comboTables(comboById.get(x.combo_id)).includes(t.id))) && toMin(x.time) <= t0 && toMin(x.time) + x.duration_minutes > t0);
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
      const name = await askText('New room', '', 'e.g. Patio, Bar, Private room'); if (!name) return;
      const a = await api('/api/admin/areas', { body: { name, sort_order: floor.areas.length } }).catch(fail);
      if (a) { S.floorArea = a.id; viewFloor().catch(fail); }
    };
    if (S.floorArea) {
      document.getElementById('ren-area').onclick = async () => {
        const a = floor.areas.find((z) => z.id === S.floorArea); const name = await askText('Rename room', a.name); if (!name) return;
        await api(`/api/admin/areas/${a.id}`, { method: 'PUT', body: { name } }).catch(fail); viewFloor().catch(fail);
      };
      document.getElementById('del-area').onclick = async () => {
        if (!await ask('Delete this room? Its tables move to “Unassigned”.', 'Delete room', true)) return;
        await api(`/api/admin/areas/${S.floorArea}`, { method: 'DELETE' }).catch(fail); S.floorArea = null; viewFloor().catch(fail);
      };
    }
    document.getElementById('add-table').onclick = () => tablePanel({ label: `T${floor.tables.length + 1}`, min_seats: 2, max_seats: 4, shape: 'square', area_id: S.floorArea, online_bookable: 1, active: 1, rotation: 0, x: 40, y: 40 });
    renderCombos(floor);
    const sel = floor.tables.find((z) => z.id === S.selTable);
    if (sel) tablePanel(sel);
  }

  // ---------------- Table combinations ----------------
  function renderCombos(floor) {
    const box = document.getElementById('combos');
    const label = (id) => (floor.tables.find((t) => t.id === id) || { label: '?' }).label;
    box.innerHTML = `<div class="row"><h2 style="margin:0">Table combinations</h2><span class="spacer"></span><button class="btn secondary sm" id="add-combo">+ Combine tables</button></div>
      <p class="muted small">Push tables together for bigger parties. When a party is bigger than any single table, Rbooked seats them on a combination automatically (online and in the book) and blocks every table in it. Tip: in Reservations › Floor plan you can tap tables to combine them.</p>
      ${(floor.combos || []).length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Combination</th><th>Tables</th><th>Seats</th><th>Online</th><th></th></tr></thead><tbody>
      ${floor.combos.map((c) => `<tr data-combo="${c.id}" class="${c.active ? '' : 'dim'}"><td><b>${esc(c.name)}</b></td><td>${comboTables(c).map(label).map(esc).join(' + ')}</td><td>${c.min_seats}-${c.max_seats}</td>
        <td>${c.online_bookable ? 'Yes' : 'Staff only'}</td><td style="text-align:right;white-space:nowrap"><button class="btn secondary sm" data-edit-combo="${c.id}">Edit</button> <button class="btn ghost sm" data-del-combo="${c.id}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No combinations yet. Example: join T4 and T5 to seat a party of 8.</p>'}`;
    const hl = (c, on) => comboTables(c).forEach((id) => { const el = document.querySelector(`.ftable[data-id="${id}"]`); if (el) el.classList.toggle('combo-hl', on); });
    box.querySelectorAll('tr[data-combo]').forEach((tr) => {
      const c = floor.combos.find((z) => z.id === Number(tr.dataset.combo));
      tr.onmouseenter = () => hl(c, true); tr.onmouseleave = () => hl(c, false);
    });
    document.getElementById('add-combo').onclick = () => comboModal(floor, null);
    box.querySelectorAll('[data-edit-combo]').forEach((b) => { b.onclick = () => comboModal(floor, floor.combos.find((z) => z.id === Number(b.dataset.editCombo))); });
    box.querySelectorAll('[data-del-combo]').forEach((b) => {
      b.onclick = async () => {
        if (!await ask('Delete this table combination?', 'Delete', true)) return;
        await api(`/api/admin/combos/${b.dataset.delCombo}`, { method: 'DELETE' }).catch(fail); viewFloor().catch(fail);
      };
    });
  }

  function comboModal(floor, c) {
    const chosen = new Set(c ? comboTables(c) : (S.selTable ? [S.selTable] : []));
    const areaName = (id) => (floor.areas.find((a) => a.id === id) || { name: 'Unassigned' }).name;
    TB.modal(`<h2>${c ? `Edit ${esc(c.name)}` : 'Combine tables'}</h2><form id="c-form">
      <div class="field"><label>Tables to push together</label><div class="days" id="c-tables">${floor.tables.filter((t) => t.active).map((t) => `<label><input type="checkbox" value="${t.id}" ${chosen.has(t.id) ? 'checked' : ''}>${esc(t.label)} <span class="muted small">${t.max_seats} · ${esc(areaName(t.area_id))}</span></label>`).join('')}</div></div>
      <div class="field"><label for="c-name">Name</label><input id="c-name" name="name" value="${esc(c ? c.name : '')}" placeholder="e.g. T4 + T5"></div>
      <div class="grid-2"><div class="field"><label for="c-min">Min party</label><input id="c-min" type="number" min="1" name="min_seats" value="${c ? c.min_seats : ''}"></div>
      <div class="field"><label for="c-max">Max party</label><input id="c-max" type="number" min="1" name="max_seats" value="${c ? c.max_seats : ''}"></div></div>
      <label class="check"><input type="checkbox" name="online_bookable" ${!c || c.online_bookable ? 'checked' : ''}> Guests can book it online</label>
      <label class="check" style="margin-top:6px"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> Active</label>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit">${c ? 'Save' : 'Create combination'}</button><button class="btn secondary" type="button" data-close>Cancel</button></div></form>`,
    (m, close) => {
      const f = m.querySelector('#c-form');
      const ids = () => [...m.querySelectorAll('#c-tables input:checked')].map((x) => Number(x.value));
      const suggest = () => {
        const ts = floor.tables.filter((t) => ids().includes(t.id));
        if (ts.length < 2) return;
        f.name.placeholder = ts.map((t) => t.label).join(' + ');
        if (!c) { f.max_seats.value = ts.reduce((a, t) => a + t.max_seats, 0); f.min_seats.value = Math.max(...ts.map((t) => t.max_seats)) + 1; }
      };
      m.querySelectorAll('#c-tables input').forEach((x) => { x.onchange = suggest; }); suggest();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const d = TB.formData(f);
        const body = { table_ids: ids(), name: d.name || f.name.placeholder, min_seats: Number(d.min_seats) || undefined, max_seats: Number(d.max_seats) || undefined, online_bookable: d.online_bookable, active: d.active };
        try {
          await api(c ? `/api/admin/combos/${c.id}` : '/api/admin/combos', { method: c ? 'PUT' : 'POST', body });
          close(); TB.toast(c ? 'Combination saved' : 'Tables combined'); viewFloor().catch(fail);
        } catch (err) { fail(err); }
      };
    });
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
        if (!await ask(`Delete table ${t.label}? Its reservations become unassigned and combinations using it are removed.`, 'Delete table', true)) return;
        await api(`/api/admin/tables/${t.id}`, { method: 'DELETE' }).catch(fail); S.selTable = null; viewFloor().catch(fail);
      };
    }
  }

  // ---------------- Services / shifts ----------------
  async function viewServices() {
    const [{ shifts, closures }, me] = await Promise.all([api('/api/admin/shifts'), api('/api/admin/restaurant')]);
    S.me.restaurant = { ...S.me.restaurant, ...me.restaurant };
    S.today0 = nowLocal().date;
    view.innerHTML = `<div class="two-col"><div>
        <div class="row" style="margin-bottom:8px"><h2 style="margin:0">Services</h2><span class="spacer"></span><button class="btn secondary" id="add-shift">+ Add service</button></div>
        <p class="small muted" style="margin:0 0 10px">Services are the times guests can book online. Tick the days each one runs, then press <b>Save changes</b> once.</p>
        <div class="card week-card" id="week"></div>
        <div id="shift-list"></div>
        <div class="save-bar" id="save-bar" hidden><span>You have unsaved changes</span><span class="spacer"></span><button class="btn" id="save-all">Save changes</button></div></div>
      <div><div class="card" id="turns" style="margin-bottom:16px"></div><div class="card"><h2>Special hours & holidays</h2><p class="muted small">Different hours, or closed, on specific dates only. Your usual services stay the same on every other day.</p>
        <form id="c-form" class="sp-form">
          <div class="grid-2"><div class="field"><label for="sp-date">Date</label><input id="sp-date" type="date" name="date" required></div>
          <div class="field"><label for="sp-why">Name <span class="muted small">(optional)</span></label><input id="sp-why" name="reason" placeholder="e.g. Christmas Eve"></div></div>
          <div class="seg sp-kind" role="radiogroup"><label><input type="radio" name="kind" value="hours" checked> Special hours</label><label><input type="radio" name="kind" value="closed"> Closed all day</label></div>
          <div class="grid-2 sp-times"><div class="field"><label for="sp-open">First seating</label><input id="sp-open" type="time" name="open_time" value="17:00"></div>
          <div class="field"><label for="sp-close">Last seating</label><input id="sp-close" type="time" name="close_time" value="20:00"></div></div>
          <button class="btn" type="submit">Add special day</button></form>
        <table class="data" style="margin-top:12px">${closures.filter((c) => c.date >= S.today0).map((c) => `<tr><td><b>${TB.date(c.date, { weekday: 'short', year: 'numeric' })}</b>${c.reason ? `<div class="small muted">${esc(c.reason)}</div>` : ''}</td><td>${c.open_time ? `${TB.time(c.open_time)} – ${TB.time(c.close_time)}` : '<span class="tag warn">Closed</span>'}</td><td style="text-align:right"><button class="btn ghost sm" data-del="${c.id}">Remove</button></td></tr>`).join('') || '<tr><td class="muted">No special days coming up.</td></tr>'}</table>
      </div></div></div>`;
    turnsEditor();
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
        <div class="field"><label>Turn time (min) <span class="muted small">used if lengths by party size are off</span></label><input type="number" name="turn_minutes" min="15" step="15" value="${s.turn_minutes}"></div>
        <div class="field"><label>Max covers per slot (0 = no limit)</label><input type="number" name="max_covers_per_slot" min="0" value="${s.max_covers_per_slot}"></div>
      </div>
      <div class="row">${s.id ? '<button class="btn ghost" type="button" data-del-shift>Delete service</button>' : '<span class="small muted">New service: press Save changes below.</span>'}</div></form>`;
    list.innerHTML = shifts.map(card).join('') || '<p class="muted">No services yet. Add one so guests can book.</p>';
    // The week at a glance: which days take bookings, and when. Warns when the profile says open but no service runs.
    const hours = TBMatch.parseHours(S.me.restaurant.hours);
    const week = () => {
      const cur = [...list.querySelectorAll('form')].map((f) => ({ name: f.name.value, active: f.active.checked, start: f.start_time.value, end: f.end_time.value, days: [...f.querySelectorAll('input[name=day]:checked')].map((x) => Number(x.value)) }));
      document.getElementById('week').innerHTML = `<div class="week">${[1, 2, 3, 4, 5, 6, 0].map((d) => {
        const on = cur.filter((s) => s.active && s.days.includes(d));
        const openDay = hours && !hours[d].closed;
        return `<div class="wk-day ${on.length ? 'on' : 'off'}"><b>${DAY_NAMES[d]}</b>${on.length ? on.map((s) => `<span>${esc(s.name)}<br>${TB.time(s.start)}–${TB.time(s.end)}</span>`).join('') : `<span>No bookings</span>${openDay ? '<span class="wk-warn">Open in your profile</span>' : ''}`}</div>`;
      }).join('')}</div>
      ${hours ? '<div class="row" style="margin-top:10px"><span class="small muted">Want bookings to follow your opening hours?</span><button class="btn ghost sm" id="from-hours">Match my opening hours</button></div>' : ''}`;
      const fh = document.getElementById('from-hours');
      if (fh) fh.onclick = async () => {
        if (!await ask('Replace your services with ones that match your opening hours? Last seating is an hour before closing.', 'Replace services')) return;
        try { await api('/api/admin/shifts/from-hours', { body: {} }); TB.toast('Services now follow your opening hours'); viewServices().catch(fail); } catch (e) { fail(e); }
      };
    };
    week();
    const dirty = new Set();
    const bar = document.getElementById('save-bar');
    const markDirty = (f) => { dirty.add(f); bar.hidden = false; week(); };
    const saveOne = async (f) => {
        const days = [...f.querySelectorAll('input[name=day]:checked')].map((x) => x.value);
        const body = { name: f.name.value, active: f.active.checked, days, start_time: f.start_time.value, end_time: f.end_time.value,
          slot_interval: Number(f.slot_interval.value), turn_minutes: Number(f.turn_minutes.value), max_covers_per_slot: Number(f.max_covers_per_slot.value) };
        if (!days.length) throw new Error(`Pick at least one day for ${body.name || 'each service'}.`);
        if (!body.start_time || !body.end_time) throw new Error('Set the first and last seating.');
        if (body.end_time < body.start_time) throw new Error(`${body.name}: last seating must be after first seating.`);
        const saved = await api(f.dataset.id ? `/api/admin/shifts/${f.dataset.id}` : '/api/admin/shifts', { method: f.dataset.id ? 'PUT' : 'POST', body });
        f.dataset.id = saved.id;
    };
    document.getElementById('save-all').onclick = async (e) => {
      e.target.disabled = true;
      try {
        for (const f of [...dirty]) { if (!f.reportValidity()) throw new Error('Fill in the highlighted field.'); await saveOne(f); dirty.delete(f); }
        TB.toast('Services saved'); viewServices().catch(fail);
      } catch (err) { fail(err); } finally { e.target.disabled = false; }
    };
    const bind = () => list.querySelectorAll('form').forEach((f) => {
      f.oninput = () => markDirty(f); f.onchange = () => markDirty(f);
      f.onsubmit = (e) => { e.preventDefault(); markDirty(f); document.getElementById('save-all').click(); };
      const del = f.querySelector('[data-del-shift]');
      if (del) del.onclick = async () => { if (await ask('Delete this service?', 'Delete', true)) { await api(`/api/admin/shifts/${f.dataset.id}`, { method: 'DELETE' }).catch(fail); viewServices().catch(fail); } };
    });
    bind();
    document.getElementById('add-shift').onclick = () => {
      if (!list.querySelector('form')) list.innerHTML = '';
      list.insertAdjacentHTML('afterbegin', card({ name: 'Dinner', active: 1, days: '0,1,2,3,4,5,6', start_time: '17:00', end_time: '21:30', slot_interval: 15, turn_minutes: 90, max_covers_per_slot: 0 }));
      bind(); markDirty(list.querySelector('form'));
    };
    const cf = document.getElementById('c-form');
    const kind = () => cf.querySelector('input[name=kind]:checked').value;
    cf.querySelectorAll('input[name=kind]').forEach((r) => { r.onchange = () => { cf.querySelector('.sp-times').hidden = kind() === 'closed'; }; });
    cf.onsubmit = async (e) => {
      e.preventDefault();
      const d = TB.formData(cf);
      try {
        await api('/api/admin/closures', { body: { date: d.date, reason: d.reason, closed: kind() === 'closed', open_time: d.open_time, close_time: d.close_time } });
        TB.toast(kind() === 'closed' ? 'Closed day added' : 'Special hours added'); viewServices().catch(fail);
      } catch (err) { fail(err); }
    };
    view.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await api(`/api/admin/closures/${b.dataset.del}`, { method: 'DELETE' }).catch(fail); viewServices().catch(fail); }; });
  }

  // Reservation length by party size: "2 guests 1.5 h, 6 guests 3 h…"
  function turnsEditor() {
    const box = document.getElementById('turns');
    let rows = TBMatch.parseTurns(S.me.restaurant.turn_times);
    const on = rows.length > 0;
    if (!on) rows = TBMatch.parseTurns(TBMatch.DEFAULT_TURNS);
    const opts = (sel) => [45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 210, 240, 270, 300].map((m) => `<option value="${m}"${m === sel ? ' selected' : ''}>${m % 60 ? `${Math.floor(m / 60) ? `${Math.floor(m / 60)} h ` : ''}${m % 60} min` : `${m / 60} h`}</option>`).join('');
    const draw = () => {
      let lo = 1;
      box.innerHTML = `<h2>Reservation length</h2><p class="muted small">How long a party keeps its table, by size. Rbooked uses this to hold tables and work out open times, online and in the book.</p>
        <label class="check"><input type="checkbox" id="tt-on" ${box.dataset.off === '1' ? '' : 'checked'}> Set length by party size</label>
        <div id="tt-rows" style="margin-top:10px;${box.dataset.off === '1' ? 'opacity:.45;pointer-events:none' : ''}">${rows.map((r, i) => {
          const last = i === rows.length - 1;
          const from = lo; lo = r.max + 1;
          return `<div class="tt-row"><span class="tt-from">${last ? `${from}+ guests` : `${from}${from === r.max ? '' : ` to`}`}</span>
            ${last ? '' : `<input type="number" min="${from}" max="40" value="${r.max}" data-max="${i}" aria-label="Up to guests"><span class="muted small">guests</span>`}
            <span class="tt-arrow">→</span><select data-min="${i}" aria-label="Length">${opts(r.minutes)}</select>
            ${rows.length > 1 && !last ? `<button class="btn ghost sm" data-rm="${i}" aria-label="Remove">✕</button>` : ''}</div>`;
        }).join('')}
        <button class="btn ghost sm" id="tt-add" type="button">+ Add a party size</button></div>
        <div class="row" style="margin-top:12px"><button class="btn" id="tt-save">Save lengths</button><span class="muted small" id="tt-sum"></span></div>`;
      box.querySelector('#tt-sum').textContent = turnSummary();
      box.querySelector('#tt-on').onchange = (e) => { box.dataset.off = e.target.checked ? '' : '1'; draw(); };
      box.querySelectorAll('[data-max]').forEach((x) => { x.onchange = () => { rows[Number(x.dataset.max)].max = Math.max(1, Number(x.value) || 1); rows.sort((a, b) => a.max - b.max); draw(); }; });
      box.querySelectorAll('[data-min]').forEach((x) => { x.onchange = () => { rows[Number(x.dataset.min)].minutes = Number(x.value); }; });
      box.querySelectorAll('[data-rm]').forEach((x) => { x.onclick = () => { rows.splice(Number(x.dataset.rm), 1); draw(); }; });
      box.querySelector('#tt-add').onclick = () => {
        const prev = rows.length > 1 ? rows[rows.length - 2].max : 0;
        rows.splice(rows.length - 1, 0, { max: prev + 2, minutes: rows[rows.length - 1].minutes }); draw();
      };
      box.querySelector('#tt-save').onclick = async () => {
        const last = rows[rows.length - 1]; last.max = Math.max(last.max, 99);
        const turn_times = box.dataset.off === '1' ? '' : rows.map((r) => `${r.max}:${r.minutes}`).join(',');
        try {
          await api('/api/admin/restaurant', { method: 'PUT', body: { turn_times } });
          S.me = await api('/api/admin/restaurant'); TB.toast('Reservation lengths saved'); draw();
        } catch (e) { fail(e); }
      };
    };
    if (!on) box.dataset.off = '1';
    draw();
  }

  // ---------------- Guests: address book ----------------
  async function viewGuests() {
    view.innerHTML = `<div class="toolbar"><input type="search" id="g-q" placeholder="Search name, phone, email, notes" style="width:300px">
        <div class="chips" id="g-tags"></div><span class="spacer"></span><button class="btn" id="g-add">+ Add guest</button></div>
      <div class="book"><div class="card" style="padding:0" id="g-list"></div><div class="card" id="g-card"><p class="muted" style="margin:0">Select a guest to see their profile, notes and visit history.</p></div></div>`;
    let tagFilter = '';
    const load = async () => {
      const data = await api(`/api/admin/guests?q=${encodeURIComponent(document.getElementById('g-q').value)}&tag=${encodeURIComponent(tagFilter)}`);
      S.guests = null;
      document.getElementById('g-tags').innerHTML = data.tags.map((t) => `<button type="button" class="chip${t === tagFilter ? ' on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('');
      document.querySelectorAll('#g-tags [data-t]').forEach((b) => { b.onclick = () => { tagFilter = tagFilter === b.dataset.t ? '' : b.dataset.t; load().catch(fail); }; });
      document.getElementById('g-list').innerHTML = `<div class="g-count muted small">${data.guests.length} contact${data.guests.length === 1 ? '' : 's'}</div>` + (data.guests.map((g) => `
        <button type="button" class="g-row${S.openGuest === g.id ? ' on' : ''}" data-id="${g.id}">
          <span class="avatar">${esc(TB.initials(g.name) || '?')}</span>
          <span class="g-main"><b>${esc(g.name)}</b><span class="small muted">${esc(g.phone || g.email || 'No contact info')}</span>
            <span class="guest-tags">${(g.tags || '').split(',').filter(Boolean).map((t) => `<span class="tag ${/vip/i.test(t) ? 'vip' : /allerg/i.test(t) ? 'warn' : 'good'}">${esc(t)}</span>`).join('')}${g.no_shows ? `<span class="tag warn">${g.no_shows} no-show</span>` : ''}</span></span>
          <span class="g-side small muted">${g.visits || 0} visit${g.visits === 1 ? '' : 's'}${g.next_visit ? `<br><b style="color:var(--ok)">Next ${TB.date(g.next_visit.slice(0, 10))}</b>` : ''}</span>
        </button>`).join('') || '<p class="muted" style="padding:16px">No guests match.</p>');
      document.querySelectorAll('.g-row').forEach((b) => { b.onclick = () => { S.openGuest = Number(b.dataset.id); document.querySelectorAll('.g-row').forEach((x) => x.classList.toggle('on', x === b)); openGuest(S.openGuest); }; });
      if (S.openGuest && data.guests.some((g) => g.id === S.openGuest)) openGuest(S.openGuest);
    };
    let t; document.getElementById('g-q').oninput = () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 200); };
    document.getElementById('g-add').onclick = () => guestForm(null, load);
    await load();
  }

  async function openGuest(id) {
    const card = document.getElementById('g-card');
    if (!card) return;
    const { guest: g, reservations } = await api(`/api/admin/guests/${id}`);
    card.innerHTML = `<div class="row"><span class="avatar lg">${esc(TB.initials(g.name) || '?')}</span><div style="min-width:0"><h2 style="margin:0;font-size:22px">${esc(g.name)}</h2>
        <div class="guest-tags">${(g.tags || '').split(',').filter(Boolean).map((x) => `<span class="tag ${/vip/i.test(x) ? 'vip' : /allerg/i.test(x) ? 'warn' : 'good'}">${esc(x)}</span>`).join('')}</div></div></div>
      <div class="kv"><span>Phone</span><b>${g.phone ? `<a href="tel:${esc(g.phone)}">${esc(g.phone)}</a>` : '—'}</b><span>Email</span><b>${esc(g.email || '—')}</b>
        <span>Birthday</span><b>${esc(g.birthday || '—')}</b><span>Marketing</span><b>${g.marketing_opt_in ? 'Opted in' : 'No'}</b></div>
      ${g.notes ? `<div class="alert" style="margin:10px 0">📇 ${esc(g.notes)}</div>` : ''}
      <div class="stats" style="grid-template-columns:repeat(4,1fr);margin:12px 0"><div class="stat"><b>${g.reservations}</b><span>Bookings</span></div><div class="stat"><b>${g.visits}</b><span>Visits</span></div>
        <div class="stat"><b>${g.no_shows}</b><span>No-shows</span></div><div class="stat"><b>${g.cancellations}</b><span>Cancelled</span></div></div>
      <div class="row"><button class="btn" id="g-book">Book a table</button><button class="btn secondary" id="g-edit">Edit</button><span class="spacer"></span><button class="btn ghost" id="g-del">Delete</button></div>
      <h3 style="margin:18px 0 6px">History</h3>
      ${reservations.length ? `<table class="data">${reservations.map((x) => `<tr><td>${TB.date(x.date, { year: 'numeric' })}<br><span class="small muted">${TB.time(x.time)}</span></td><td>${x.party_size} ppl · ${esc(x.table_label || 'No table')}${x.notes ? `<div class="small muted">${esc(x.notes)}</div>` : ''}</td><td><span class="badge ${x.status}">${STATUS_LABEL[x.status]}</span></td></tr>`).join('')}</table>` : '<p class="muted">No reservations yet.</p>'}`;
    document.getElementById('g-book').onclick = () => reservationModal(null, () => openGuest(id), { guest_name: g.name, guest_phone: g.phone, guest_email: g.email, date: nowLocal().date });
    document.getElementById('g-edit').onclick = () => guestForm(g, () => viewGuests().catch(fail));
    document.getElementById('g-del').onclick = async () => {
      if (!await ask(`Delete ${g.name} from your address book? Their past reservations stay.`, 'Delete guest', true)) return;
      await api(`/api/admin/guests/${id}`, { method: 'DELETE' }).catch(fail); S.openGuest = null; viewGuests().catch(fail);
    };
    if (window.matchMedia('(max-width: 1000px)').matches) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function guestForm(g, done) {
    const v = g || { name: '', phone: '', email: '', birthday: '', tags: '', notes: '', marketing_opt_in: 0 };
    TB.modal(`<h2>${g ? 'Edit guest' : 'Add guest'}</h2><form id="gf">
      <div class="field"><label for="gf-name">Name</label><input id="gf-name" name="name" value="${esc(v.name)}" required></div>
      <div class="grid-2"><div class="field"><label for="gf-phone">Phone</label><input id="gf-phone" name="phone" type="tel" value="${esc(v.phone)}"></div>
      <div class="field"><label for="gf-email">Email</label><input id="gf-email" name="email" type="email" value="${esc(v.email)}"></div></div>
      <div class="grid-2"><div class="field"><label for="gf-bday">Birthday</label><input id="gf-bday" name="birthday" value="${esc(v.birthday)}" placeholder="MM-DD"></div>
      <div class="field"><label for="gf-tags">Tags (comma separated)</label><input id="gf-tags" name="tags" value="${esc(v.tags)}" placeholder="VIP, Regular, Allergy"></div></div>
      <div class="chips" style="margin:-6px 0 12px">${['VIP', 'Regular', 'Allergy', 'Vegan', 'Industry', 'Big spender'].map((t) => `<button type="button" class="chip" data-add="${t}">+ ${t}</button>`).join('')}</div>
      <div class="field"><label for="gf-notes">Notes (allergies, favorite table, preferences)</label><textarea id="gf-notes" name="notes">${esc(v.notes)}</textarea></div>
      <label class="check"><input type="checkbox" name="marketing_opt_in" ${v.marketing_opt_in ? 'checked' : ''}> OK to send news and offers</label>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit">${g ? 'Save' : 'Add to address book'}</button><button class="btn secondary" type="button" data-close>Cancel</button></div></form>`,
    (m, close) => {
      const f = m.querySelector('#gf');
      m.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => { const set = new Set(f.tags.value.split(',').map((x) => x.trim()).filter(Boolean)); set.add(b.dataset.add); f.tags.value = [...set].join(', '); }; });
      f.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const saved = await api(g ? `/api/admin/guests/${g.id}` : '/api/admin/guests', { method: g ? 'PUT' : 'POST', body: TB.formData(f) });
          S.openGuest = saved.id; S.guests = null; close(); TB.toast(g ? 'Guest saved' : 'Guest added'); done && done();
        } catch (err) { fail(err); }
      };
    });
  }

  // ---------------- Widget ----------------
  async function viewWidget() {
    const r = S.me.restaurant; const base = S.me.baseUrl;
    const inline = `<div data-rbooked="${r.slug}"></div>\n<script src="${base}/widget.js" async></script>`;
    const button = `<script src="${base}/widget.js" data-restaurant="${r.slug}" data-mode="button" data-color="${r.accent_color}" data-label="Reserve a table" async></script>`;
    const iframe = `<iframe src="${base}/embed.html?r=${r.slug}" title="Reserve a table" style="width:100%;max-width:480px;height:640px;border:0"></iframe>`;
    const link = S.me.demoBase ? `${base}/restaurant.html?slug=${r.slug}` : `${base}/r/${r.slug}`;
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
    view.innerHTML = `<form id="s-form"><div class="two-col">
      <div class="card"><h2>Account & notifications</h2>
        <p class="small muted">Your name, photos, menu, hours and website are on the <a href="#profile">Restaurant profile</a> page.</p>
        <div class="field"><label>Notification email (new bookings / cancellations)</label><input name="email" type="email" value="${esc(r.email)}"></div>
        <p class="small muted">Time zone: <b>${esc(TBPlaces.tzLabel(r.timezone))}</b>, set automatically from your ZIP code.</p>
        ${r.featured ? '<p class="small" style="margin-top:8px"><span class="feat-badge">Featured</span> Your restaurant is featured on the Rbooked home page.</p>' : ''}
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
        await api('/api/admin/restaurant', { method: 'PUT', body });
        S.me = await api('/api/admin/restaurant');
        document.getElementById('rest-name').textContent = S.me.restaurant.name;
        document.documentElement.style.setProperty('--brand', S.me.restaurant.accent_color);
        TB.toast('Settings saved');
      } catch (err) { fail(err); }
    };
    view.insertAdjacentHTML('beforeend', `<div class="card" style="margin-top:16px"><h2>Login and account</h2>
      <p class="small muted" style="margin:0">You log in with <b>${esc(S.me.user.email)}</b>. To change your login email, or for anything else about your account, email <a href="mailto:rbookedsupport@gmail.com">rbookedsupport@gmail.com</a>.</p></div>`);
  }

  // ---------------- Billing ----------------
  async function viewBilling() {
    const b = await api('/api/admin/billing');
    S.me.billing = b; renderBanner();
    const statusText = { trialing: `Free trial, ${b.trialDaysLeft} day${b.trialDaysLeft === 1 ? '' : 's'} left`, active: 'Active subscription', past_due: 'Payment past due', canceled: 'Cancelled', expired: 'Trial ended' }[b.status];
    if (b.billingOff) {
      view.innerHTML = `<div class="card" style="max-width:640px"><h2>Your plan</h2>
        <p style="font-size:28px;margin:0" class="serif">Free</p>
        <p>Rbooked is free while we launch. There's nothing to pay and no card needed. Your restaurant stays visible in search and the booking widget stays on.</p>
        <p class="muted small">Later the plan will be $49/month with a 14-day free trial. We'll email you well before anything changes.</p></div>`;
      return;
    }
    const ok = location.hash.includes('checkout=success');
    view.innerHTML = `<div class="two-col"><div class="card">
      ${ok ? '<div class="alert ok" style="margin-bottom:14px">Thanks! Your payment method was saved. It can take a few seconds for the status to update.</div>' : ''}
      <h2>Your plan</h2>
      <p style="font-size:28px;margin:0" class="serif">$49<span class="muted" style="font-size:16px">/month</span></p>
      <p>Status: <b>${statusText}</b>${b.status === 'trialing' ? `<br><span class="muted small">Trial ends ${new Date(b.trialEndsAt).toLocaleDateString()}. You won't be charged before then.</span>` : ''}</p>
      <div class="row">
        ${b.hasPaymentMethod ? '<button class="btn" id="portal">Manage billing & invoices</button>' : `<button class="btn" id="checkout">${b.status === 'trialing' ? 'Add payment method' : 'Subscribe for $49/month'}</button>`}
      </div>
      ${b.demoMode ? `<div class="alert" style="margin-top:18px"><b>Demo mode:</b> Stripe keys aren't configured, so no real payments happen. Use these buttons to try each state.
        <div class="row" style="margin-top:10px"><button class="btn secondary sm" data-sim="active">Simulate paid</button><button class="btn secondary sm" data-sim="expired">Simulate trial ended</button></div></div>` : ''}
    </div>
    <div class="card"><h2>How billing works</h2><ul style="line-height:1.9">
      <li>Every restaurant gets <b>14 days free</b>. No credit card required to sign up.</li>
      <li>Add a card any time during the trial. Your first $49 charge happens when the trial ends.</li>
      <li>If the trial ends without a card, you're hidden from search and the widget pauses. Your data is kept.</li>
      <li>Cancel any time from “Manage billing”.</li></ul></div></div>`;
    const go = async (path) => { try { const { url } = await api(path, { body: {} }); location.href = url; } catch (e) { fail(e); } };
    const c = document.getElementById('checkout'); if (c) c.onclick = () => (b.demoMode ? TB.toast('Stripe is not configured; use the demo buttons below.', true) : go('/api/admin/billing/checkout'));
    const p = document.getElementById('portal'); if (p) p.onclick = () => go('/api/admin/billing/portal');
    view.querySelectorAll('[data-sim]').forEach((x) => { x.onclick = async () => { await api('/api/admin/billing/simulate', { body: { status: x.dataset.sim } }).catch(fail); viewBilling().catch(fail); }; });
  }

  // ---------------- Email log ----------------
  // Rbooked staff only: pick which restaurants are featured on the home page.

  async function viewEmails() {
    const rows = await api('/api/admin/emails');
    view.innerHTML = `<div class="card" style="padding:0"><div class="table-wrap"><table class="data">
      <thead><tr><th>Sent (UTC)</th><th>Type</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
      <tbody>${rows.map((e) => `<tr><td>${esc(e.created_at)}</td><td>${esc(e.kind.replace('_', ' '))}</td><td>${esc(e.to_addr)}</td>
        <td><a href="/api/admin/emails/${e.id}" target="_blank" rel="noopener">${esc(e.subject)}</a></td>
        <td><span class="badge ${e.status === 'failed' ? 'cancelled' : e.status === 'sent' ? 'seated' : ''}">${e.status === 'outbox' ? 'not sent (email key missing)' : esc(e.status)}</span>${e.error ? `<div class="small muted">${esc(e.error)}</div>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No emails yet.</td></tr>'}</tbody></table></div></div>`;
  }

  boot();
})();
