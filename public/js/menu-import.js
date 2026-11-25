/* Turn a pasted menu, a CSV/spreadsheet, or text read from a PDF/photo into menu items.
   Shared by the browser (window.TBMenuImport) and the tests (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBMenuImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SECTION_WORDS = /^(appeti[sz]ers?|starters?|small plates?|large plates?|plates|shareables?|snacks|bites|tapas|mains?|main courses?|entr[eé]es?|soups?|salads?|soups? (and|&) salads?|sides?|side dishes|desserts?|sweets|drinks|beverages|cocktails|mocktails|wines?|wines? by the glass|beers?|beer (and|&) wine|spirits|coffee( (and|&) tea)?|tea|juices?|smoothies|breakfast|brunch|lunch|dinner|specials?|chef'?s specials?|kids( menu)?|children'?s menu|pasta|pastas|pizzas?|sandwich(es)?|burgers?|wraps?|tacos|burritos|bowls?|noodles?|rice|curr(y|ies)|sushi|rolls|sashimi|nigiri|grill|from the grill|seafood|steaks?|chicken|vegetarian|vegan|dim sum|raw bar|antipasti|primi|secondi|contorni|dolci|for the table|to share|extras|add[- ]ons)$/i;
  const PRICE_AT_END = /(?:^|[\s.·•…_\-–—|:])\s*\$?\s*(\d{1,4}(?:[.,]\d{1,2})?)(?:\s*(?:\/|\|)\s*\$?\s*\d{1,4}(?:[.,]\d{1,2})?)?\s*(?:usd)?\s*$/i;
  const PRICE_ONLY = /^\s*\$?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*$/;

  // Diet markers found in names/descriptions, e.g. "(V)", "GF", "vegan", "🌶".
  const MARKERS = [
    [/\((?:vg|ve)\)|\bvegan\b|🌱/i, 'vegan'],
    [/\(v\)|\bvegetarian\b|🥕/i, 'vegetarian'],
    [/\(gf\)|\bgf\b|\bgluten[- ]free\b/i, 'gluten_free'],
    [/\(df\)|\bdf\b|\bdairy[- ]free\b/i, 'dairy_free'],
    [/\(nf\)|\bnut[- ]free\b/i, 'nut_free'],
    [/\bhalal\b/i, 'halal'],
    [/🌶️?|\(s\)|\bspicy\b|\bhot\b(?! dog)|\bchil[ei] (?:oil|crisp|flakes)\b/i, 'spicy'],
  ];
  const STRIP_MARKERS = /\s*(\((?:v|vg|ve|gf|df|nf|s)\)|\b(?:gf|df)\b|🌱|🌶️?)\s*/gi;

  function tagsFor(text) {
    const tags = new Set();
    for (const [re, tag] of MARKERS) if (re.test(text)) tags.add(tag);
    if (tags.has('vegan')) { tags.add('vegetarian'); tags.add('dairy_free'); }
    return [...tags];
  }
  const clean = (s) => String(s || '').replace(/[.·•…_]{2,}/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—•*·|:#~^]+|[\s\-–—•*·|:#~^]+$/g, '').trim();
  const priceOf = (s) => String(s).replace(',', '.');
  const isAllCaps = (s) => /[A-Z]/.test(s) && s === s.toUpperCase() && !/[a-z]/.test(s);
  const titleCase = (s) => (isAllCaps(s) ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(And|Of|The|With|In|On|A)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase()) : s);

  function finish(it) {
    const text = `${it.name} ${it.description}`;
    const tags = tagsFor(text);
    return {
      section: it.section || 'Menu',
      name: titleCase(clean(it.name.replace(STRIP_MARKERS, ' '))).slice(0, 120),
      description: clean(it.description.replace(STRIP_MARKERS, ' ')).slice(0, 500),
      price: it.price || '',
      tags,
    };
  }

  /** Free text (pasted, or read from a PDF/photo) → items. */
  function parseText(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\t/g, '  ').trim()).filter((l) => l && !/^page \d+( of \d+)?$/i.test(l));
    const items = [];
    let section = 'Menu';
    let last = null; // the item lines are being attached to
    let lastFromPrev = false; // last item was started by the previous line, still without a price
    for (const raw of lines) {
      const line = raw.replace(/\s+/g, ' ');
      const only = PRICE_ONLY.exec(line);
      if (only) { if (last && !last.price) last.price = priceOf(only[1]); lastFromPrev = false; continue; }
      const m = PRICE_AT_END.exec(line);
      const before = m ? clean(line.slice(0, m.index)) : '';
      if (m && before && /[a-z]/i.test(before)) {
        const price = priceOf(m[1]);
        // "Pad Thai" then "rice noodles, egg … 16": the second line is the description.
        if (last && lastFromPrev && !last.price && (/^[a-z]/.test(before) || before.includes(',')) && !last.description) {
          last.description = before; last.price = price; lastFromPrev = false; continue;
        }
        let name = before; let description = '';
        const split = /\s+[-–—:]\s+|\s*[—–]\s*/.exec(before);
        if (split && split.index > 1 && split.index < 60) { name = before.slice(0, split.index); description = before.slice(split.index + split[0].length); }
        last = { section, name, description, price }; items.push(last); lastFromPrev = false;
        continue;
      }
      const plain = clean(line);
      if (!plain) continue;
      const words = plain.split(/\s+/).length;
      const header = SECTION_WORDS.test(plain.replace(/:$/, '')) || (/:$/.test(plain) && words <= 5) || (isAllCaps(plain) && words <= 5 && !(last && lastFromPrev));
      if (header) { section = titleCase(plain.replace(/:$/, '')).slice(0, 60); last = null; lastFromPrev = false; continue; }
      const titleLike = words <= 5 && plain.split(/\s+/).filter((w) => /^[A-Z0-9&]/.test(w)).length >= Math.ceil(words * 0.6);
      if (last && (/^[a-z(]/.test(plain) || words > 6 || plain.includes(',') || (!last.description && last.price && !titleLike))) {
        last.description = last.description ? `${last.description} ${plain}` : plain; lastFromPrev = false; continue;
      }
      last = { section, name: plain, description: '', price: '' }; items.push(last); lastFromPrev = true;
    }
    return items.map(finish).filter((it) => it.name && it.name.length > 1);
  }

  /** CSV text → rows (handles quotes, commas, tabs and semicolons). */
  function csvRows(text) {
    const s = String(text || '').replace(/\r/g, '');
    const first = s.split('\n')[0] || '';
    const delim = [',', '\t', ';'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
  }

  /** Spreadsheet rows (CSV or Excel) → items. Columns are found by their header names. */
  function parseRows(rows) {
    if (!rows.length) return [];
    const head = rows[0].map((h) => String(h).toLowerCase());
    const find = (re) => head.findIndex((h) => re.test(h));
    let col = { section: find(/section|category|course|group|type/), name: find(/^(name|item|dish|title|product)|item name|dish name/), price: find(/price|cost|\$|amount/), description: find(/desc|detail|ingredient/), tags: find(/tag|diet|allergen/) };
    let body = rows.slice(1);
    if (col.name < 0) {
      // No header: guess "name, price" or "section, name, price, description".
      body = rows;
      const n = rows[0].length;
      const priceCol = rows[0].findIndex((c) => PRICE_ONLY.test(c));
      col = n >= 3 && priceCol === 2 ? { section: 0, name: 1, price: 2, description: 3, tags: -1 } : { section: -1, name: 0, price: priceCol >= 0 ? priceCol : 1, description: priceCol === 1 ? 2 : -1, tags: -1 };
    }
    const get = (r, i) => (i >= 0 && r[i] !== undefined ? String(r[i]).trim() : '');
    return body.map((r) => {
      const name = get(r, col.name); if (!name) return null;
      const priceRaw = get(r, col.price).replace(/[^0-9.,]/g, '');
      const it = finish({ section: get(r, col.section) || 'Menu', name, description: get(r, col.description), price: priceRaw ? priceOf(priceRaw) : '' });
      const extra = tagsFor(get(r, col.tags)); it.tags = [...new Set([...it.tags, ...extra])];
      return it;
    }).filter(Boolean);
  }

  const parseCSV = (text) => parseRows(csvRows(text));
  return { parseText, parseCSV, parseRows, csvRows, tagsFor };
});
