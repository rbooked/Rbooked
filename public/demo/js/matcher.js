/* "Pick for me" matcher + restaurant tag list.
   Shared by the server (require) and the browser demo (window.TBMatch). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Tags restaurants pick in their dashboard; diners pick from the same list.
  const TAGS = [
    { id: 'vegan', label: 'Vegan', group: 'diet' },
    { id: 'vegetarian', label: 'Vegetarian', group: 'diet' },
    { id: 'gluten_free', label: 'Gluten-free', group: 'diet' },
    { id: 'halal', label: 'Halal', group: 'diet' },
    { id: 'classy', label: 'Classy', group: 'vibe' },
    { id: 'casual', label: 'Casual', group: 'vibe' },
    { id: 'romantic', label: 'Romantic', group: 'vibe' },
    { id: 'lively', label: 'Lively', group: 'vibe' },
    { id: 'quiet', label: 'Quiet', group: 'vibe' },
    { id: 'family', label: 'Family-friendly', group: 'vibe' },
    { id: 'outdoor', label: 'Outdoor seating', group: 'extra' },
    { id: 'cocktails', label: 'Great cocktails', group: 'extra' },
    { id: 'views', label: 'Views', group: 'extra' },
    { id: 'late_night', label: 'Late night', group: 'extra' },
  ];
  const TAG_IDS = new Set(TAGS.map((t) => t.id));
  const label = (id) => (TAGS.find((t) => t.id === id) || { label: id }).label;

  const parseTags = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => TAG_IDS.has(x));
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fmt = (t) => { const m = toMin(t); const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

  /**
   * Rank candidates for a diner.
   * candidates: [{ restaurant, miles, slots: ['HH:MM' available times] }]
   * want: { prefs: [tag ids], price: 0-4 (0 = any), time: 'HH:MM', windowMinutes }
   * Returns the best matches with a score (0-100), the chosen time and reasons.
   */
  function rank(candidates, want) {
    const prefs = (want.prefs || []).filter((p) => TAG_IDS.has(p));
    const target = toMin(want.time || '19:00');
    const windowMin = want.windowMinutes || 90;
    const out = [];
    for (const c of candidates) {
      const r = c.restaurant;
      const times = c.slots.filter((t) => Math.abs(toMin(t) - target) <= windowMin)
        .sort((a, b) => Math.abs(toMin(a) - target) - Math.abs(toMin(b) - target));
      if (!times.length) continue; // only suggest places that can actually seat them
      const tags = parseTags(r.tags);
      const matched = prefs.filter((p) => tags.includes(p));
      const missed = prefs.filter((p) => !tags.includes(p));
      // Diet needs are dealbreakers: never suggest a non-vegan spot to a vegan.
      if (missed.some((p) => (TAGS.find((t) => t.id === p) || {}).group === 'diet')) continue;
      const best = times[0];
      const off = Math.abs(toMin(best) - target);
      let points = 0;
      points += prefs.length ? (matched.length / prefs.length) * 55 : 35;
      if (want.price) points += r.price_level === want.price ? 15 : Math.abs(r.price_level - want.price) === 1 ? 6 : -10;
      else points += 10;
      points += Math.max(0, 15 - off / 6);          // closer to the time they want
      points += c.miles == null ? 4 : Math.max(0, 10 - c.miles); // closer to them
      if (r.featured) points += 5;
      const reasons = [];
      if (matched.length) reasons.push(matched.map(label).join(' · '));
      reasons.push(off === 0 ? `Table open at ${fmt(best)}` : `Closest open table: ${fmt(best)}`);
      if (c.miles != null) reasons.push(`${c.miles} mi away`);
      if (want.price && r.price_level === want.price) reasons.push(`${'$'.repeat(r.price_level)} like you asked`);
      if (r.featured) reasons.push('Featured on Rbooked');
      out.push({
        restaurant: r, miles: c.miles, time: best, times: times.slice(0, 4).sort(), score: Math.max(1, Math.min(99, Math.round(points))),
        matched, missed, reasons,
      });
    }
    return out.sort((a, b) => b.score - a.score || a.time.localeCompare(b.time));
  }

  // ---- Reservation length by party size ----
  // Stored as "maxParty:minutes" pairs, e.g. "2:90,4:120,6:180,99:210":
  // parties up to 2 get 90 minutes, up to 4 get 2 hours, and so on. Empty = use each service's turn time.
  const DEFAULT_TURNS = '2:90,4:120,6:180,99:210';
  function parseTurns(str) {
    const rows = String(str || '').split(',').map((p) => p.split(':').map(Number))
      .filter(([max, min]) => max >= 1 && min >= 15 && min <= 720).map(([max, minutes]) => ({ max: Math.round(max), minutes: Math.round(minutes / 15) * 15 }));
    const seen = new Set();
    return rows.sort((a, b) => a.max - b.max).filter((r) => !seen.has(r.max) && seen.add(r.max));
  }
  const formatTurns = (rows) => parseTurns(rows.map((r) => `${r.max}:${r.minutes}`).join(',')).map((r) => `${r.max}:${r.minutes}`).join(',');
  function turnFor(str, party, fallback) {
    const rows = parseTurns(str);
    if (!rows.length) return fallback;
    const hit = rows.find((r) => party <= r.max) || rows[rows.length - 1];
    return hit.minutes;
  }

  // ---- Menu dietary tags ----
  const MENU_TAGS = [
    { id: 'vegetarian', label: 'Vegetarian', icon: '🥕' }, { id: 'vegan', label: 'Vegan', icon: '🌱' },
    { id: 'gluten_free', label: 'Gluten-free', icon: '🌾' }, { id: 'dairy_free', label: 'Dairy-free', icon: '🥛' },
    { id: 'nut_free', label: 'Nut-free', icon: '🥜' }, { id: 'halal', label: 'Halal', icon: '☪️' }, { id: 'spicy', label: 'Spicy', icon: '🌶️' },
  ];
  const MENU_TAG_IDS = new Set(MENU_TAGS.map((t) => t.id));
  const parseMenuTags = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((t) => String(t).trim()).filter((t) => MENU_TAG_IDS.has(t)))];
  const sortMenuTags = (tags) => String(tags || '').split(',').filter(Boolean).sort((a, b) => MENU_TAGS.findIndex((t) => t.id === a) - MENU_TAGS.findIndex((t) => t.id === b));
  const menuTag = (id) => MENU_TAGS.find((t) => t.id === id) || { id, label: id, icon: '' };

  // ---- Opening hours: JSON list of 7 days (0 = Sunday) like {closed:0, open:'17:00', close:'22:00'} ----
  function parseHours(v) {
    let a; try { a = typeof v === 'string' ? JSON.parse(v || '[]') : v; } catch { a = []; }
    if (!Array.isArray(a) || a.length !== 7) return null;
    const ok = (t) => /^\d{2}:\d{2}$/.test(t || '');
    return a.map((d) => ({ closed: d && d.closed ? 1 : 0, open: ok(d && d.open) ? d.open : '17:00', close: ok(d && d.close) ? d.close : '22:00' }));
  }
  // Is the restaurant open at this weekday/minute? Handles closing after midnight.
  function openAt(hours, weekday, minutes) {
    const h = parseHours(hours); if (!h) return null;
    const m = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
    const today = h[weekday]; const prev = h[(weekday + 6) % 7];
    if (!today.closed && minutes >= m(today.open) && (m(today.close) > m(today.open) ? minutes < m(today.close) : true)) return true;
    if (!prev.closed && m(prev.close) <= m(prev.open) && minutes < m(prev.close)) return true;
    return false;
  }

  /** A restaurant's own hashtag, from its name: "Queen Mama's Kitchen" -> "#QueenMamasKitchen". */
  function hashtag(name) {
    const words = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, '').replace(/&/g, ' And ').split(/[^A-Za-z0-9]+/).filter(Boolean);
    const tag = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('').slice(0, 40);
    return tag ? `#${tag}` : '';
  }

  return { hashtag, TAGS, TAG_IDS, label, parseTags, rank, DEFAULT_TURNS, parseTurns, formatTurns, turnFor, MENU_TAGS, parseMenuTags, menuTag, sortMenuTags, parseHours, openAt };
});
