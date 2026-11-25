// Pricing comparison shown on the For restaurants page. Edit the numbers here; the table, savings cards,
// "save up to" message and calculator are all worked out from this list.
// monthly: starting price in US dollars per month, or null for "custom pricing".
(function (root) {
  const TBPricing = {
    reviewed: 'November 25, 2026',
    rbooked: { name: 'RBooked', monthly: 49, fees: 'No booking fees' },
    competitors: [
      { name: 'OpenTable Basic', monthly: 149, fees: 'Per-guest fees apply', card: true },
      { name: 'OpenTable Core', monthly: 299, fees: 'Network guest fees apply' },
      { name: 'Resy Platform', monthly: 289, fees: 'No per-guest fees', card: true },
      { name: 'Tock Essential', monthly: 289, fees: '3% on prepayments', card: true },
      { name: 'SevenRooms', monthly: null, fees: 'Varies' },
    ],
    sources: [
      { name: 'OpenTable', url: 'https://www.opentable.com/restaurant-solutions/plans/' },
      { name: 'Resy', url: 'https://resy.com/join/plans-pricing/' },
      { name: 'Tock', url: 'https://www.exploretock.com/join/pricing/' },
      { name: 'SevenRooms', url: 'https://sevenrooms.com/pricing/' },
    ],
  };
  /** Biggest saving vs a listed starting price, as a whole percent (rounded down so it's never overstated). */
  TBPricing.maxSavingPct = () => {
    const prices = TBPricing.competitors.map((c) => c.monthly).filter((n) => n);
    return prices.length ? Math.floor((1 - TBPricing.rbooked.monthly / Math.max(...prices)) * 100) : 0;
  };
  TBPricing.yearlySaving = (monthly) => Math.max(0, (monthly - TBPricing.rbooked.monthly) * 12);
  if (typeof module !== 'undefined' && module.exports) module.exports = TBPricing; else root.TBPricing = TBPricing;
}(typeof window !== 'undefined' ? window : globalThis));
