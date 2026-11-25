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
      if (r.featured) reasons.push('Featured on Tablebird');
      out.push({
        restaurant: r, miles: c.miles, time: best, times: times.slice(0, 4).sort(), score: Math.max(1, Math.min(99, Math.round(points))),
        matched, missed, reasons,
      });
    }
    return out.sort((a, b) => b.score - a.score || a.time.localeCompare(b.time));
  }

  return { TAGS, TAG_IDS, label, parseTags, rank };
});
