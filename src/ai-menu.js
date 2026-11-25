'use strict';
// Smart menu reading with Cloudflare Workers AI (free daily allowance on the Workers Free plan, no card).
// Turns messy menu text (from a PDF, a photo, a website or a paste) into dishes with sections, prices,
// descriptions, diet tags and options such as sizes and add-ons. Returns null when AI isn't available,
// so callers fall back to the built-in reader.
const menuImport = require('../public/js/menu-import');

const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'];
const TAGS = ['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'nut_free', 'halal', 'spicy'];

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, price: { type: 'string' },
          tags: { type: 'array', items: { type: 'string', enum: TAGS } },
          options: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, choices: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'string' } }, required: ['name'] } } }, required: ['name', 'choices'] } },
        },
        required: ['name'],
      },
    },
  },
  required: ['items'],
};

const PROMPT = `You turn restaurant menu text into structured dishes. The text was copied from a PDF, a photo or a website, so it can be messy:
- Letters may be spaced out ("S a l e e g $ 2 4 . 9 5" means "Saleeg $24.95") and words may run together ("LambShankw/MandiRice" means "Lamb Shank w/ Mandi Rice"). Fix the spelling of spacing only; never invent dishes.
- Put ONLY the dish name in "name" (no price, no description). Use normal capitalization.
- "price" is the base price as digits only, like "24.95". If the dish has sizes, use the smallest size's price. Leave it "" if there is no price.
- "description" is the ingredients or details, cleaned up, or "".
- "section" is the menu heading the dish is under (Appetizers, Mains, Drinks…), in Title Case. Use "Menu" if there is none.
- "options" holds choices the guest picks: sizes (name "Size", each choice with its full price), add-ons or extras (name "Add-ons", price like "+3"), choice of protein, sides, spice level, etc. Only include options the text actually lists.
- "tags": vegetarian, vegan, gluten_free, dairy_free, nut_free, halal, spicy — only when the menu marks it ((V), (VG), GF, a pepper icon, "vegan"…). Vegan also means vegetarian and dairy_free.
- Skip lines that are not dishes: addresses, hours, phone numbers, notes like "20% gratuity for parties of 6+".
Return JSON: {"items":[...]} in menu order.`;

/** Split long text on line breaks into chunks the model can handle. */
function chunks(text, size = 5000, max = 6) {
  const out = []; let cur = '';
  for (const line of String(text).split('\n')) {
    if (cur.length + line.length + 1 > size && cur) { out.push(cur); cur = ''; if (out.length >= max) break; }
    cur += `${line}\n`;
  }
  if (cur.trim() && out.length < max) out.push(cur);
  return out;
}

async function runChunk(ai, text) {
  let lastErr;
  for (const model of MODELS) {
    try {
      const r = await ai.run(model, {
        messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: `Menu text:\n"""\n${text}\n"""` }],
        response_format: { type: 'json_schema', json_schema: SCHEMA },
        max_tokens: 6000, temperature: 0.1,
      });
      let data = r && r.response !== undefined ? r.response : r;
      if (typeof data === 'string') { const m = /\{[\s\S]*\}/.exec(data); data = m ? JSON.parse(m[0]) : null; }
      if (data && Array.isArray(data.items)) return data.items;
      lastErr = new Error('AI returned no items');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('AI unavailable');
}

const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** Normalise what the model returned into the importer's item shape. */
function tidy(items) {
  const seen = new Set();
  return (items || []).map((it) => {
    const tags = new Set((Array.isArray(it.tags) ? it.tags : []).filter((t) => TAGS.includes(t)));
    menuImport.tagsFor(`${it.name} ${it.description}`).forEach((t) => tags.add(t));
    if (tags.has('vegan')) { tags.add('vegetarian'); tags.add('dairy_free'); }
    const price = (/\d{1,4}(?:[.,]\d{1,2})?/.exec(String(it.price ?? '')) || [''])[0].replace(',', '.');
    return { section: clean(it.section, 60) || 'Menu', name: clean(it.name, 120), description: clean(it.description, 500), price, tags: [...tags], options: menuImport.cleanOptions(it.options) };
  }).filter((it) => {
    if (!it.name || it.name.length < 2) return false;
    const k = `${it.section}|${it.name}|${it.price}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
  });
}

/** Menu text → dishes, or null if AI isn't set up / fails (use the built-in reader then). */
async function aiParseMenu(text) {
  const ai = globalThis.__rbAI;
  if (!ai || typeof ai.run !== 'function') return null;
  const body = String(text || '').trim().slice(0, 30000);
  if (body.length < 20) return [];
  try {
    const all = [];
    for (const c of chunks(body)) all.push(...await runChunk(ai, c));
    return tidy(all);
  } catch (e) {
    console.error('[ai-menu]', e && e.message);
    return null;
  }
}

module.exports = { aiParseMenu, tidy, chunks, available: () => !!(globalThis.__rbAI && globalThis.__rbAI.run) };
