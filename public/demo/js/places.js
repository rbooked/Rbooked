/* Cuisine categories, US states, and time zone from ZIP code.
   Shared by the server (require) and the browser (window.TBPlaces). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBPlaces = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Fixed list so guests can filter by cuisine. Keep names stable: they're stored on restaurants.
  const CUISINES = [
    'American', 'New American', 'Barbecue', 'Brazilian', 'Breakfast & Brunch', 'Burgers', 'Cafe', 'Cajun & Creole',
    'Caribbean', 'Chinese', 'Cuban', 'Ethiopian', 'French', 'Gastropub', 'German', 'Greek', 'Halal', 'Hawaiian & Poke',
    'Indian', 'Irish', 'Italian', 'Japanese', 'Korean', 'Latin American', 'Lebanese', 'Mediterranean', 'Mexican',
    'Middle Eastern', 'Moroccan', 'Peruvian', 'Pizza', 'Ramen & Noodles', 'Seafood', 'Soul Food', 'Southern', 'Spanish & Tapas',
    'Steakhouse', 'Sushi', 'Thai', 'Turkish', 'Vegan', 'Vegetarian', 'Vietnamese', 'Wine Bar', 'Other',
  ];
  const ALIASES = { Spanish: 'Spanish & Tapas', Ramen: 'Ramen & Noodles', Brunch: 'Breakfast & Brunch', BBQ: 'Barbecue' };
  /** Map free text to a category, or '' if it doesn't match one. */
  function cuisine(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    const hit = CUISINES.find((c) => c.toLowerCase() === s.toLowerCase());
    return hit || ALIASES[s] || '';
  }

  const STATES = [
    ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
    ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
    ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
    ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'],
    ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
    ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
    ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'],
    ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
    ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
    ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ];
  const STATE_CODES = new Set(STATES.map((s) => s[0]));
  const E = 'America/New_York', C = 'America/Chicago', M = 'America/Denver', P = 'America/Los_Angeles';
  const STATE_TZ = {
    AL: C, AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: C, CA: P, CO: M, CT: E, DE: E, DC: E, FL: E, GA: E,
    HI: 'Pacific/Honolulu', ID: M, IL: C, IN: E, IA: C, KS: C, KY: E, LA: C, ME: E, MD: E, MA: E, MI: E, MN: C, MS: C,
    MO: C, MT: M, NE: C, NV: P, NH: E, NJ: E, NM: M, NY: E, NC: E, ND: C, OH: E, OK: C, OR: P, PA: E, PR: 'America/Puerto_Rico',
    RI: E, SC: E, SD: C, TN: C, TX: C, UT: M, VT: E, VA: E, WA: P, WV: E, WI: C, WY: M,
  };
  // States split across time zones: the first 3 digits of the ZIP decide.
  const ZIP3_TZ = {
    324: C, 325: C, // Florida panhandle
    373: E, 374: E, 376: E, 377: E, 378: E, 379: E, // East Tennessee
    420: C, 421: C, 422: C, 423: C, 424: C, 427: C, // Western Kentucky
    463: C, 464: C, 476: C, 477: C, // Northwest and southwest Indiana
    498: C, // Michigan, western Upper Peninsula
    586: M, 577: M, 693: M, 677: M, // Western ND, SD, NE, KS
    798: M, 799: M, 885: M, // El Paso, TX
    835: P, 838: P, // North Idaho
    979: M, // Eastern Oregon
  };
  // ZIP ranges per state, so the time zone is right even if the state is missing.
  const ZIP_STATE = [[5, '--'], [6, 'NY'], [10, 'PR'], [28, 'MA'], [30, 'RI'], [39, 'NH'], [50, 'ME'], [60, 'VT'], [70, 'CT'], [90, 'NJ'],
    [150, 'NY'], [197, 'PA'], [200, 'DE'], [206, 'DC'], [220, 'MD'], [247, 'VA'], [270, 'WV'], [290, 'NC'], [300, 'SC'], [320, 'GA'],
    [350, 'FL'], [370, 'AL'], [386, 'TN'], [400, 'MS'], [430, 'KY'], [460, 'OH'], [480, 'IN'], [500, 'MI'], [530, 'IA'], [550, 'WI'],
    [570, 'MN'], [580, 'SD'], [590, 'ND'], [600, 'MT'], [630, 'IL'], [660, 'MO'], [680, 'KS'], [700, 'NE'], [716, 'LA'], [730, 'AR'],
    [750, 'OK'], [800, 'TX'], [816, 'CO'], [832, 'WY'], [840, 'ID'], [850, 'UT'], [870, 'AZ'], [885, 'NM'], [900, 'NV'],
    [962, 'CA'], [967, 'AP'], [970, 'HI'], [980, 'OR'], [995, 'WA'], [1000, 'AK']];
  function stateForZip(zip) {
    const z3 = Number(String(zip || '').slice(0, 3));
    if (!/^\d{5}$/.test(String(zip || ''))) return '';
    if (z3 === 739) return 'OK'; if (z3 === 885) return 'TX';
    const row = ZIP_STATE.find(([lim]) => z3 < lim);
    return row && STATE_CODES.has(row[1]) ? row[1] : '';
  }
  /** Time zone for a US ZIP (state is a fallback when the ZIP isn't known). */
  function timezoneFor(zip, state) {
    const z3 = Number(String(zip || '').slice(0, 3));
    if (ZIP3_TZ[z3]) return ZIP3_TZ[z3];
    const st = stateForZip(zip) || String(state || '').toUpperCase();
    return STATE_TZ[st] || E;
  }
  const TZ_LABEL = { [E]: 'Eastern', [C]: 'Central', [M]: 'Mountain', 'America/Phoenix': 'Arizona (no daylight saving)', [P]: 'Pacific',
    'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii', 'America/Puerto_Rico': 'Atlantic (Puerto Rico)' };
  const tzLabel = (tz) => TZ_LABEL[tz] || tz;

  return { CUISINES, cuisine, STATES, STATE_CODES, stateForZip, timezoneFor, tzLabel };
});
