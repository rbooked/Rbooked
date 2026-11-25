/* Website import, shared by the signup page and the dashboard profile.
   TBSite.read(url) asks the server to read a restaurant's website (nothing is saved).
   TBSite.choicesHtml(found) renders checkboxes for what to use; TBSite.apply(found, picks) saves it to the
   signed-in restaurant: profile details, photos, logo and menu. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (path, opts) => window.TB.api(path, opts);

  async function read(url) { return api('/api/public/site-import', { body: { url } }); }

  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const t12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
  const hoursText = (h) => h.map((d, i) => `${DAY[i]} ${d.closed ? 'closed' : `${t12(d.open)}–${t12(d.close)}`}`).join(' · ');

  /** Checkbox list of everything we found, all ticked. `withDetails` adds name/address/phone/cuisine rows. */
  function choicesHtml(f, withDetails) {
    const row = (key, label, detail) => `<label class="site-pick"><input type="checkbox" data-pick="${key}" checked><span><b>${label}</b>${detail ? `<span class="muted small">${detail}</span>` : ''}</span></label>`;
    const rows = [];
    if (withDetails) {
      if (f.name) rows.push(row('name', 'Name', esc(f.name)));
      if (f.address) rows.push(row('address', 'Address', esc([f.address, f.city, f.state, f.zip].filter(Boolean).join(', '))));
      if (f.phone) rows.push(row('phone', 'Phone', esc(f.phone)));
      if (f.cuisine) rows.push(row('cuisine', 'Cuisine', esc(f.cuisine)));
    }
    if (f.description) rows.push(row('description', 'Description', esc(f.description.slice(0, 140)) + (f.description.length > 140 ? '…' : '')));
    if (f.hours) rows.push(row('hours', 'Opening hours', esc(hoursText(f.hours))));
    rows.push(row('website', 'Website link', esc(f.website_url)));
    if (f.images && f.images.length) {
      rows.push(`<div class="site-pick"><input type="checkbox" data-pick="photos" checked id="sp-photos"><span><label for="sp-photos"><b>Photos</b> <span class="muted small">First is your main photo, the rest go in your gallery. Tap a photo to skip it.</span></label>
        <span class="site-imgs">${f.images.map((u, i) => `<button type="button" class="site-img on" data-img="${i}" aria-pressed="true" title="Use this photo"><img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></button>`).join('')}</span></span></div>`);
    }
    if (f.logo) rows.push(row('logo', 'Logo', `<img src="${esc(f.logo)}" alt="" class="site-logo" referrerpolicy="no-referrer" onerror="this.closest('label').remove()">`));
    if (f.menu && f.menu.length) rows.push(row('menu', `Menu: ${f.menu.length} dishes`, `You'll check every dish before it's saved.`));
    else if (f.menu_pdf) rows.push(row('menu', 'Menu (PDF)', 'We’ll read it and show you every dish before it’s saved.'));
    return `<div class="site-picks">${rows.join('')}</div>`;
  }
  function bindChoices(root) {
    root.querySelectorAll('.site-img').forEach((b) => { b.onclick = () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }; });
  }
  function picks(root) {
    const p = {}; root.querySelectorAll('[data-pick]').forEach((c) => { p[c.dataset.pick] = c.checked; });
    p.images = [...root.querySelectorAll('.site-img.on')].map((b) => Number(b.dataset.img));
    return p;
  }

  /** Save the picked parts to the signed-in restaurant. Returns { menuItems, menuPdf } for the menu review step. */
  async function apply(f, p, status = () => {}) {
    const body = {};
    if (p.name && f.name) body.name = f.name;
    if (p.address && f.address) Object.assign(body, { address: f.address, city: f.city, state: f.state, zip: f.zip });
    if (p.phone && f.phone) body.phone = f.phone;
    if (p.cuisine && f.cuisine) body.cuisine = f.cuisine;
    if (p.description && f.description) body.description = f.description;
    if (p.hours && f.hours) body.hours = f.hours;
    if (p.website && f.website_url) body.website_url = f.website_url;
    if (f.price_level) body.price_level = f.price_level;
    for (const k of Object.keys(body)) if (body[k] === '' || body[k] == null) delete body[k];
    if (Object.keys(body).length) { status('Saving your details…'); await api('/api/admin/restaurant', { method: 'PUT', body }); }
    const errors = [];
    if (p.photos && f.images) {
      const chosen = (p.images || []).map((i) => f.images[i]).filter(Boolean).slice(0, 13);
      for (let i = 0; i < chosen.length; i++) {
        status(`Saving photo ${i + 1} of ${chosen.length}…`);
        try { await api('/api/admin/images', { body: { kind: i === 0 ? 'cover' : 'gallery', url: chosen[i] } }); } catch (e) { errors.push(e.message); }
      }
    }
    if (p.logo && f.logo) { status('Saving your logo…'); try { await api('/api/admin/images', { body: { kind: 'logo', url: f.logo } }); } catch (e) { errors.push(e.message); } }
    status('');
    return { menuItems: p.menu && f.menu && f.menu.length ? f.menu : null, menuPdf: p.menu && !(f.menu && f.menu.length) ? f.menu_pdf || null : null, errors };
  }

  window.TBSite = { read, choicesHtml, bindChoices, picks, apply, hoursText };
})();
