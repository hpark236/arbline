// Pricing math shared by the API and the browser. Every price here is the
// cost, in dollars, of a claim that pays $1 if the named side wins.

export const KALSHI_FEE_RATE = 0.07;

/** American odds (+124 / -148) to decimal odds (2.24 / 1.6757). */
export function americanToDecimal(american) {
  const a = Number(String(american).replace(/[^\d.+-]/g, ''));
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

/** Decimal odds back to American, for display. */
export function decimalToAmerican(dec) {
  if (!dec || dec <= 1) return null;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

/**
 * Remove the bookmaker margin from a two-way market.
 * method "proportional" scales both sides by the overround.
 * method "power" solves p_a^k + p_b^k = 1, which shades more vig onto longshots.
 */
export function devig(impliedA, impliedB, method = 'proportional') {
  const total = impliedA + impliedB;
  if (method === 'power') {
    let lo = 0.5, hi = 3;
    for (let i = 0; i < 60; i++) {
      const k = (lo + hi) / 2;
      const s = impliedA ** k + impliedB ** k;
      if (s > 1) lo = k; else hi = k;
    }
    const k = (lo + hi) / 2;
    return { a: impliedA ** k, b: impliedB ** k, overround: total - 1 };
  }
  return { a: impliedA / total, b: impliedB / total, overround: total - 1 };
}

/** Kalshi taker fee per contract (before the exchange rounds the order total up to the cent). */
export function kalshiFee(price, rate = KALSHI_FEE_RATE) {
  return rate * price * (1 - price);
}

/** Kalshi rounds the fee for the whole order up to the next cent. */
export function kalshiOrderFee(price, contracts, rate = KALSHI_FEE_RATE) {
  return Math.ceil(rate * contracts * price * (1 - price) * 100 - 1e-9) / 100;
}

/** Polymarket taker fee per share: fee = C x feeRate x p x (1 - p). */
export function polyFee(price, rate) {
  return rate * price * (1 - price);
}

/**
 * Given the best all-in cost of each side, describe the two-leg trade.
 * If costA + costB < 1, buying one $1 claim on each side locks in a profit.
 */
export function twoWay(costA, costB) {
  const sum = costA + costB;
  return {
    sum,
    isArb: sum < 1,
    roi: 1 / sum - 1, // return on capital if you buy both legs
    gapCents: (sum - 1) * 100, // how far the pair is from break-even
  };
}

/**
 * Split a bankroll across two legs so the payout is identical whichever side wins.
 * Returns stakes, claims bought and the locked-in profit (negative if no arb).
 */
export function stakePlan(bankroll, costA, costB) {
  const claims = bankroll / (costA + costB);
  return {
    claims,
    stakeA: claims * costA,
    stakeB: claims * costB,
    payout: claims,
    profit: claims - bankroll,
  };
}

/** Pick the cheapest quote for a side. Quotes look like { venue, cost }. */
export function cheapest(quotes) {
  return quotes.filter(q => q && Number.isFinite(q.cost) && q.cost > 0 && q.cost < 1)
    .sort((x, y) => x.cost - y.cost)[0] || null;
}

/**
 * Full analysis of one game. venues = { book, poly, kalshi }, each optional,
 * each { a: {cost, price, fee, size}, b: {...}, fairA? }.
 */
export function analyseGame(venues) {
  const names = Object.keys(venues).filter(v => venues[v]);
  const quotesA = names.map(v => venues[v].a && { venue: v, ...venues[v].a });
  const quotesB = names.map(v => venues[v].b && { venue: v, ...venues[v].b });
  const bestA = cheapest(quotesA);
  const bestB = cheapest(quotesB);

  // every cross-venue pairing, so the board can show which combination is closest
  const pairs = [];
  for (const va of names) for (const vb of names) {
    const qa = venues[va].a, qb = venues[vb].b;
    if (!qa || !qb || !(qa.cost > 0) || !(qb.cost > 0)) continue;
    pairs.push({ legA: va, legB: vb, ...twoWay(qa.cost, qb.cost) });
  }
  pairs.sort((x, y) => x.sum - y.sum);

  const fair = names.map(v => ({ venue: v, pA: venues[v].fairA })).filter(f => Number.isFinite(f.pA));
  const spread = fair.length > 1
    ? (Math.max(...fair.map(f => f.pA)) - Math.min(...fair.map(f => f.pA))) * 100
    : 0;

  return {
    bestA, bestB,
    best: bestA && bestB ? { legA: bestA.venue, legB: bestB.venue, ...twoWay(bestA.cost, bestB.cost) } : null,
    pairs,
    fair,
    spreadPts: spread, // biggest disagreement on P(A wins), in percentage points
  };
}

/**
 * Walk two ask ladders together and size the arbitrage by actual depth.
 * ladder: [[price, size], ...] best first; size Infinity for a sportsbook line.
 * feeA / feeB: functions price -> fee per $1 claim.
 * Stops at the first level where the marginal pair costs $1 or more.
 */
export function walkDepth(ladderA, ladderB, feeA = () => 0, feeB = () => 0, maxClaims = Infinity) {
  let i = 0, j = 0, claims = 0, cost = 0;
  const la = ladderA.map(l => [...l]), lb = ladderB.map(l => [...l]);
  const fills = [];
  while (i < la.length && j < lb.length && claims < maxClaims) {
    const [pa, sa] = la[i], [pb, sb] = lb[j];
    const unit = pa + feeA(pa) + pb + feeB(pb);
    if (unit >= 1) break;
    const n = Math.min(sa, sb, maxClaims - claims);
    if (!(n > 0)) break;
    claims += n; cost += n * unit;
    fills.push({ pa, pb, n, unit });
    la[i][1] -= n; lb[j][1] -= n;
    if (la[i][1] <= 1e-9) i++;
    if (lb[j][1] <= 1e-9) j++;
  }
  return { claims, cost, profit: claims - cost, roi: cost ? claims / cost - 1 : 0, fills };
}

/**
 * Back one player two ways: a "yes" claim (they win) on one venue and a "no" claim
 * (they don't) on another. In a two-player match, "no" can also be bought as the
 * opponent's "yes". Returns every pairing, cheapest first.
 */
export function outcomePairs(event, outcome) {
  const yes = [], no = [];
  for (const [v, q] of Object.entries(outcome.venues)) {
    if (q.yes) yes.push({ venue: v, ...q.yes });
    if (q.no) no.push({ venue: v, via: 'no', ...q.no });
  }
  if (event.sport === 'tennis') {
    const opp = event.outcomes.find(o => o !== outcome);
    for (const [v, q] of Object.entries(opp?.venues || {})) if (q.yes) no.push({ venue: v, via: 'opponent', ...q.yes });
  }
  const pairs = [];
  for (const a of yes) for (const b of no) {
    if (a.venue === b.venue && b.via === 'no') continue; // same-venue yes+no is just the spread
    if (a.venue === b.venue && b.via === 'opponent') continue;
    pairs.push({ yes: a, no: b, ...twoWay(a.cost, b.cost) });
  }
  return pairs.sort((x, y) => x.sum - y.sum);
}

/** Implied win probability per venue for one player (Pinnacle de-vigged across the event). */
export function impliedByVenue(event, outcome) {
  const out = {};
  for (const v of ['pinnacle', 'poly', 'kalshi']) {
    const q = outcome.venues[v];
    if (!q?.yes) continue;
    if (v === 'pinnacle') {
      const total = event.outcomes.reduce((a, o) => a + (o.venues.pinnacle?.yes?.price || 0), 0);
      out[v] = total > 0 ? q.yes.price / total : q.yes.price;
    } else out[v] = q.no ? (q.yes.price + (1 - q.no.price)) / 2 : q.yes.price;
  }
  return out;
}

export function analyseEvent(event) {
  let best = null, venuesSeen = new Set();
  for (const o of event.outcomes) {
    Object.keys(o.venues).forEach(v => venuesSeen.add(v));
    o.pairs = outcomePairs(event, o);
    o.best = o.pairs[0] || null;
    const imp = impliedByVenue(event, o), vals = Object.values(imp);
    o.implied = imp;
    o.spreadPts = vals.length > 1 ? (Math.max(...vals) - Math.min(...vals)) * 100 : 0;
    if (o.best && (!best || o.best.sum < best.sum)) best = { ...o.best, outcome: o.name };
  }
  return { best, venues: [...venuesSeen], spreadPts: Math.max(0, ...event.outcomes.map(o => o.spreadPts)) };
}
