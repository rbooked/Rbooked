/* Sample content for the demo restaurants: menus, cover art and logos.
 * Used by `npm run seed` and by the in-browser demo. Works in Node and the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBSamples = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  // [section, name, description, price in dollars, tag codes]
  // Tag codes: vg vegan, v vegetarian, gf gluten-free, df dairy-free, nf nut-free, h halal, s spicy
  const M = {
    'New American': [
      ['Starters', 'Charred Carrots', 'Whipped feta, hot honey, dukkah', 14, 'v gf'],
      ['Starters', 'Little Gem Caesar', 'Anchovy, rye crumb, parmesan', 15, ''],
      ['Starters', 'Wood-fired Mushrooms', 'Miso butter, chives (ask for vegan)', 16, 'v gf'],
      ['Mains', 'Half Roast Chicken', 'Salsa verde, schmaltz potatoes', 32, 'gf df'],
      ['Mains', 'Dry-aged Burger', 'Cheddar, onion jam, fries', 26, ''],
      ['Mains', 'Market Grain Bowl', 'Farro, roasted squash, tahini, herbs', 24, 'vg df nf'],
      ['Mains', 'Hanger Steak', 'Bone marrow butter, frites', 38, 'gf'],
      ['Desserts', 'Brown Butter Cake', 'Crème fraîche, seasonal fruit', 12, 'v'],
      ['Drinks', 'Rye Old Fashioned', 'House rye blend, demerara, bitters', 17, 'vg gf'],
    ],
    Indian: [
      ['Small plates', 'Samosa Chaat', 'Chickpeas, tamarind, yogurt, sev', 11, 'v h'],
      ['Small plates', 'Gobi 65', 'Crispy cauliflower, curry leaf', 12, 'vg gf s h'],
      ['Tandoor', 'Chicken Tikka', 'Yogurt-marinated, mint chutney', 22, 'gf h'],
      ['Tandoor', 'Paneer Tikka', 'Peppers, onion, chaat masala', 20, 'v gf h'],
      ['Curries', 'Butter Chicken', 'Tomato, fenugreek, cream', 24, 'gf h'],
      ['Curries', 'Chana Masala', 'Chickpeas, ginger, amchur', 18, 'vg gf h'],
      ['Curries', 'Lamb Vindaloo', 'Goan style, very spicy', 27, 'gf df s h'],
      ['Breads', 'Garlic Naan', '', 5, 'v nf h'],
      ['Desserts', 'Gulab Jamun', 'Cardamom syrup, pistachio', 9, 'v h'],
    ],
    Italian: [
      ['Antipasti', 'Burrata', 'Heirloom tomato, basil, olive oil', 17, 'v gf'],
      ['Antipasti', 'Vitello Tonnato', 'Veal, tuna aioli, capers', 18, 'gf df'],
      ['Pasta', 'Cacio e Pepe', 'Tonnarelli, pecorino, black pepper', 24, 'v'],
      ['Pasta', 'Pappardelle Ragù', 'Slow-cooked beef and pork', 28, ''],
      ['Pasta', 'Pomodoro', 'Spaghetti, San Marzano, basil', 21, 'vg df'],
      ['Pasta', 'Gluten-free Gnocchi', 'Brown butter, sage', 25, 'v gf'],
      ['Secondi', 'Branzino', 'Lemon, olives, fennel', 36, 'gf df'],
      ['Dolci', 'Tiramisù', 'Espresso, mascarpone', 12, 'v'],
    ],
    Japanese: [
      ['Omakase', 'Chef\'s Omakase', '15 courses, seasonal fish', 165, 'gf df'],
      ['Nigiri', 'Otoro', 'Fatty bluefin tuna, 2 pieces', 22, 'gf df'],
      ['Nigiri', 'Hokkaido Scallop', 'Yuzu kosho, 2 pieces', 14, 'gf df s'],
      ['Rolls', 'Avocado Cucumber Roll', '', 10, 'vg gf'],
      ['Rolls', 'Spicy Tuna Roll', 'Togarashi mayo', 15, 'df s'],
      ['Small plates', 'Edamame', 'Sea salt', 7, 'vg gf'],
      ['Small plates', 'Agedashi Tofu', 'Dashi, grated daikon', 11, 'v df'],
      ['Desserts', 'Matcha Panna Cotta', 'Black sesame', 11, 'v gf'],
    ],
    Steakhouse: [
      ['Starters', 'Shrimp Cocktail', 'Horseradish, lemon', 24, 'gf df'],
      ['Starters', 'Wedge Salad', 'Blue cheese, bacon, tomato', 18, 'gf'],
      ['Steaks', '45-day Dry-aged Ribeye', '18 oz, bone-in', 78, 'gf df'],
      ['Steaks', 'Filet Mignon', '8 oz, center cut', 62, 'gf df'],
      ['Steaks', 'Porterhouse for Two', '40 oz, carved tableside', 145, 'gf df'],
      ['Sides', 'Creamed Spinach', '', 14, 'v gf'],
      ['Sides', 'Truffle Fries', 'Parmesan, herbs', 14, 'v'],
      ['Sides', 'Roasted Mushrooms', 'Garlic, thyme, olive oil', 15, 'vg gf'],
      ['Desserts', 'Chocolate Layer Cake', 'Six layers', 16, 'v'],
    ],
    Mexican: [
      ['Para empezar', 'Guacamole', 'Totopos made in house', 13, 'vg gf'],
      ['Para empezar', 'Esquites', 'Charred corn, lime, cotija, chile', 9, 'v gf s'],
      ['Tacos', 'Al Pastor', 'Pork, pineapple, salsa verde', 15, 'gf df'],
      ['Tacos', 'Hongos', 'Mushrooms, epazote, salsa macha', 14, 'vg gf s'],
      ['Tacos', 'Baja Fish', 'Beer batter, cabbage, crema', 16, ''],
      ['Platos', 'Mole Negro', 'Chicken thigh, sesame, rice', 26, 'gf df'],
      ['Platos', 'Enchiladas Verdes', 'Cheese, tomatillo, crema', 21, 'v gf'],
      ['Postres', 'Churros', 'Cajeta, cinnamon sugar', 10, 'v'],
      ['Bebidas', 'Mezcal Flight', 'Three pours, orange, sal de gusano', 24, 'vg gf'],
    ],
    Vegetarian: [
      ['Small plates', 'Beet Tartare', 'Capers, cashew cream, rye crisps', 14, 'vg'],
      ['Small plates', 'Blistered Shishitos', 'Smoked salt, lime', 10, 'vg gf s'],
      ['Small plates', 'Fig & Burrata', 'Balsamic, mint', 16, 'v gf nf'],
      ['Plates', 'Mushroom Bourguignon', 'Pearl onions, potato purée', 26, 'vg gf'],
      ['Plates', 'Crispy Tofu Bowl', 'Brown rice, greens, peanut sauce', 22, 'vg df'],
      ['Plates', 'Squash Risotto', 'Sage, aged parmesan', 24, 'v gf nf'],
      ['Plates', 'Cauliflower Steak', 'Romesco, herbs', 23, 'vg gf'],
      ['Desserts', 'Dark Chocolate Mousse', 'Aquafaba, sea salt', 11, 'vg gf'],
    ],
    Seafood: [
      ['Raw bar', 'Pacific Oysters', 'Half dozen, mignonette', 21, 'gf df'],
      ['Raw bar', 'Albacore Crudo', 'Citrus, chile, olive oil', 18, 'gf df s'],
      ['Starters', 'Clam Chowder', 'Bacon, potato, oyster crackers', 13, ''],
      ['Starters', 'Grilled Little Gems', 'Green goddess, herbs', 14, 'v gf'],
      ['Mains', 'Whole Grilled Rockfish', 'Salsa verde, lemon', 39, 'gf df'],
      ['Mains', 'Dungeness Crab Roll', 'Brown butter, chives', 32, ''],
      ['Mains', 'Seared Scallops', 'Corn purée, chanterelles', 41, 'gf'],
      ['Sides', 'Charred Broccolini', 'Garlic, chile flake', 11, 'vg gf s'],
      ['Desserts', 'Meyer Lemon Tart', 'Torched meringue', 11, 'v'],
    ],
    Gastropub: [
      ['Snacks', 'Scotch Egg', 'Mustard aioli', 9, ''],
      ['Snacks', 'Loaded Chips', 'Cheddar, scallion, sour cream', 11, 'v'],
      ['Mains', 'Fish & Chips', 'Ale-battered cod, mushy peas', 22, 'df'],
      ['Mains', 'Pub Burger', 'Smoked cheddar, bacon jam', 19, ''],
      ['Mains', 'Shepherd\'s Pie', 'Lamb, root veg, mash', 21, 'gf'],
      ['Mains', 'Beyond Bangers & Mash', 'Plant sausage, onion gravy', 19, 'vg df'],
      ['Salads', 'Harvest Salad', 'Apple, walnuts, cider vinaigrette', 14, 'vg gf'],
      ['Desserts', 'Sticky Toffee Pudding', 'Clotted cream', 10, 'v'],
    ],
    Barbecue: [
      ['Meats', 'Prime Brisket', 'Half pound, post oak smoked', 24, 'gf df'],
      ['Meats', 'Pork Spare Ribs', 'Half rack, dry rub', 22, 'gf df'],
      ['Meats', 'Jalapeño Cheddar Sausage', '', 12, 'gf s'],
      ['Meats', 'Smoked Jackfruit', 'BBQ glaze, pickles', 16, 'vg gf'],
      ['Sides', 'Mac & Cheese', '', 7, 'v'],
      ['Sides', 'Pinto Beans', 'No pork, slow cooked', 6, 'vg gf'],
      ['Sides', 'Vinegar Slaw', '', 5, 'vg gf'],
      ['Desserts', 'Banana Pudding', 'Nilla wafers', 8, 'v'],
    ],
    'Latin American': [
      ['Para picar', 'Arepa Reina Pepiada', 'Chicken, avocado, mayo', 12, 'gf'],
      ['Para picar', 'Arepa Dominó', 'Black beans, white cheese', 11, 'v gf'],
      ['Para picar', 'Tostones', 'Garlic mojo', 8, 'vg gf'],
      ['Ceviches', 'Ceviche Clásico', 'Corvina, leche de tigre, ají', 18, 'gf df s'],
      ['Platos', 'Lomo Saltado', 'Beef, tomato, onion, fries, rice', 26, 'df'],
      ['Platos', 'Pabellón Vegano', 'Plantain, beans, rice, jackfruit', 20, 'vg gf'],
      ['Postres', 'Tres Leches', '', 9, 'v'],
      ['Cócteles', 'Pisco Sour', 'Pisco, lime, egg white', 14, 'v gf'],
    ],
    Spanish: [
      ['Tapas', 'Pan con Tomate', 'Grilled bread, tomato, olive oil', 8, 'vg'],
      ['Tapas', 'Patatas Bravas', 'Spicy tomato, aioli', 10, 'v gf s'],
      ['Tapas', 'Gambas al Ajillo', 'Garlic shrimp, guindilla', 16, 'gf df s'],
      ['Tapas', 'Jamón Ibérico', 'Hand-carved, 2 oz', 28, 'gf df'],
      ['Raciones', 'Paella Valenciana', 'For two, chicken and rabbit', 58, 'gf df'],
      ['Raciones', 'Paella de Verduras', 'For two, seasonal vegetables', 48, 'vg gf'],
      ['Raciones', 'Pulpo a la Gallega', 'Octopus, paprika, potato', 26, 'gf df'],
      ['Postres', 'Basque Cheesecake', 'Burnt top, sherry', 12, 'v gf'],
    ],
    Thai: [
      ['Noodles', 'Pad Thai', 'Rice noodles, tamarind, peanuts (tofu or shrimp)', 16, 'gf'],
      ['Noodles', 'Khao Soi', 'Curry noodle soup, chicken', 18, 'df s'],
      ['Noodles', 'Drunken Noodles', 'Tofu, Thai basil, chile', 16, 'vg df s'],
      ['Curries', 'Green Curry', 'Eggplant, bamboo, basil (vegan option)', 17, 'gf df s'],
      ['Curries', 'Massaman Beef', 'Potato, peanut, tamarind', 19, 'gf df'],
      ['Small plates', 'Fresh Spring Rolls', 'Herbs, peanut sauce', 9, 'vg gf'],
      ['Small plates', 'Som Tum', 'Green papaya, lime, chile', 11, 'df gf s'],
      ['Desserts', 'Mango Sticky Rice', 'Coconut cream', 9, 'vg gf'],
    ],
  };
  const CODE = { vg: 'vegan', v: 'vegetarian', gf: 'gluten_free', df: 'dairy_free', nf: 'nut_free', h: 'halal', s: 'spicy' };
  function menuFor(cuisine) {
    const alias = { 'Spanish & Tapas': 'Spanish', Vegan: 'Vegetarian', Sushi: 'Japanese', 'Ramen & Noodles': 'Japanese', American: 'New American', Burgers: 'Gastropub', 'Wine Bar': 'Spanish', Southern: 'Barbecue', 'Soul Food': 'Barbecue', Mediterranean: 'Spanish', Peruvian: 'Latin American', Cuban: 'Latin American', Brazilian: 'Latin American' };
    const rows = M[cuisine] || M[alias[cuisine]] || M['New American'];
    return rows.map(([section, name, description, price, codes], i) => {
      const tags = new Set(codes.split(' ').filter(Boolean).map((c) => CODE[c]));
      if (tags.has('vegan')) { tags.add('vegetarian'); tags.add('dairy_free'); }
      return { section, name, description, price_cents: Math.round(price * 100), tags: [...tags].join(','), sort_order: i, available: 1 };
    });
  }

  const EMOJI = {
    'New American': '🔥', Indian: '🍛', Italian: '🍝', Japanese: '🍣', Steakhouse: '🥩', Mexican: '🌮', Vegetarian: '🥗',
    Seafood: '🦪', Gastropub: '🍺', Barbecue: '🍖', 'Latin American': '🫓', Spanish: '🥘', Thai: '🍜',
    American: '🍔', Burgers: '🍔', 'Spanish & Tapas': '🥘', Chinese: '🥟', Korean: '🍲', Vietnamese: '🍜', 'Ramen & Noodles': '🍜',
    Sushi: '🍣', Pizza: '🍕', French: '🥐', Greek: '🥙', Mediterranean: '🫒', 'Middle Eastern': '🧆', Lebanese: '🧆', Turkish: '🥙',
    Vegan: '🌱', Cafe: '☕', 'Breakfast & Brunch': '🥞', 'Wine Bar': '🍷', Caribbean: '🍹', Cuban: '🥪', Peruvian: '🐟',
    Brazilian: '🥩', Ethiopian: '🫓', Moroccan: '🍲', Halal: '🍢', 'Hawaiian & Poke': '🍱', 'Cajun & Creole': '🦐',
    Southern: '🍗', 'Soul Food': '🍗', German: '🥨', Irish: '🍀',
  };
  const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Placeholder art: a branded gradient with the cuisine's emoji. Restaurants replace it with their own photo.
  function coverArt(r) {
    const e = EMOJI[r.cuisine] || '🍽️';
    const c = r.accent_color || '#c2410c';
    return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 500" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#1f140c"/></linearGradient>
      <radialGradient id="l" cx=".8" cy=".2" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
      <rect width="1200" height="500" fill="url(#g)"/><rect width="1200" height="500" fill="url(#l)"/>
      <g opacity=".16" font-size="70">${[0, 1, 2, 3, 4, 5].map((i) => `<text x="${80 + i * 190}" y="${i % 2 ? 140 : 420}">${e}</text>`).join('')}</g>
      <text x="930" y="330" font-size="230" text-anchor="middle">${e}</text></svg>`);
  }
  function logoArt(r) {
    const c = r.accent_color || '#c2410c';
    const ini = r.name.split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ]/.test(w[0] || '')).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96" fill="#fff"/>
      <circle cx="100" cy="100" r="84" fill="${c}"/><circle cx="100" cy="100" r="74" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>
      <text x="100" y="122" font-family="Georgia, serif" font-weight="700" font-size="64" fill="#fff" text-anchor="middle">${xml(ini)}</text></svg>`);
  }
  // Opening hours from services: open 30 min before the first seating, close 90 min after the last.
  function hoursFromShifts(shifts) {
    const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const hh = (m) => `${String(Math.floor(Math.min(m, 1439) / 60)).padStart(2, '0')}:${String(Math.min(m, 1439) % 60).padStart(2, '0')}`;
    return [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const s = shifts.filter((x) => x.active !== 0 && String(x.days).split(',').includes(String(d)));
      if (!s.length) return { closed: 1, open: '17:00', close: '22:00' };
      return { closed: 0, open: hh(Math.max(0, Math.min(...s.map((x) => toMin(x.start_time))) - 30)), close: hh(Math.max(...s.map((x) => toMin(x.end_time))) + 90) };
    });
  }
  return { menuFor, coverArt, logoArt, hoursFromShifts };
}));
