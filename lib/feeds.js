// Venue adapters. Each one returns games keyed by `${league}:${away}@${home}:${etDate}`
// using ESPN team codes as the canonical id, so the three venues line up.
import { americanToDecimal, devig, kalshiFee, polyFee } from './core.js';

export const LEAGUES = {
  nfl: { name: 'NFL', espn: 'football/nfl', poly: 12185, kalshi: 'KXNFLGAME' },
  mlb: { name: 'MLB', espn: 'baseball/mlb', poly: 3, kalshi: 'KXMLBGAME' },
  nba: { name: 'NBA', espn: 'basketball/nba', poly: 10345, kalshi: 'KXNBAGAME' },
  nhl: { name: 'NHL', espn: 'hockey/nhl', poly: 10346, kalshi: 'KXNHLGAME' },
};

// Codes that differ from ESPN's. Found by diffing all three venues' team lists.
const ALIAS = {
  nfl: { WAS: 'WSH', LA: 'LAR', JAC: 'JAX' },
  mlb: { CWS: 'CHW', AZ: 'ARI', WAS: 'WSH' },
  nba: { UTA: 'UTAH', GSW: 'GS', NYK: 'NY', NOP: 'NO', SAS: 'SA', WAS: 'WSH' },
  nhl: { CAL: 'CGY', LAS: 'VGK', MON: 'MTL', LAK: 'LA', UTA: 'UTAH', NJD: 'NJ', SJS: 'SJ', TBL: 'TB' },
};
export const canon = (lg, code) => {
  const c = String(code || '').toUpperCase();
  return ALIAS[lg]?.[c] || c;
};

/** Calendar date in New York, which is how Kalshi tickers and US schedules are dated. */
export const etDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const gameKey = (lg, away, home, iso) => `${lg}:${away}@${home}:${etDate(iso)}`;

const UA = { 'User-Agent': 'arbline/1.0 (+https://github.com/hpark236/arbline)' };
async function getJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- Sportsbook (DraftKings lines, as published on ESPN's public scoreboard) ----------
export async function sportsbook(lg, days = 8) {
  const L = LEAGUES[lg];
  const dates = [...Array(days)].map((_, i) => new Date(Date.now() + i * 864e5).toISOString().slice(0, 10).replace(/-/g, ''));
  const boards = await Promise.allSettled(dates.map(d => getJSON(`https://site.api.espn.com/apis/site/v2/sports/${L.espn}/scoreboard?dates=${d}`)));
  const out = {};
  for (const b of boards) {
    if (b.status !== 'fulfilled') continue;
    for (const ev of b.value.events || []) {
      const comp = ev.competitions?.[0];
      if (!comp || comp.status?.type?.state !== 'pre') continue; // upcoming games only
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      if (!home || !away) continue;
      const key = gameKey(lg, away.team.abbreviation, home.team.abbreviation, ev.date);
      const game = out[key] ||= {
        key, league: lg, start: ev.date, espnId: ev.id,
        away: { code: away.team.abbreviation, name: away.team.displayName, short: away.team.shortDisplayName, logo: away.team.logo },
        home: { code: home.team.abbreviation, name: home.team.displayName, short: home.team.shortDisplayName, logo: home.team.logo },
      };
      const odds = comp.odds?.[0];
      const mlA = odds?.moneyline?.away?.close?.odds ?? odds?.awayTeamOdds?.moneyLine;
      const mlH = odds?.moneyline?.home?.close?.odds ?? odds?.homeTeamOdds?.moneyLine;
      const dA = americanToDecimal(mlA), dH = americanToDecimal(mlH);
      if (dA && dH) {
        const fair = devig(1 / dA, 1 / dH);
        game.book = {
          label: odds.provider?.displayName || odds.provider?.name || 'Sportsbook',
          a: { cost: 1 / dA, price: 1 / dA, fee: 0, american: String(mlA) },
          b: { cost: 1 / dH, price: 1 / dH, fee: 0, american: String(mlH) },
          fairA: fair.a,
          overround: fair.overround,
        };
      }
    }
  }
  return out;
}

// ---------- Polymarket (Gamma API, moneyline markets) ----------
export async function polymarket(lg) {
  const L = LEAGUES[lg];
  const since = new Date(Date.now() - 6 * 3600e3).toISOString();
  const events = [];
  for (let offset = 0; offset < 500; offset += 100) { // Gamma pages at 100 events
    const page = await getJSON(`https://gamma-api.polymarket.com/events?series_id=${L.poly}&closed=false&limit=100&offset=${offset}&end_date_min=${since}`);
    events.push(...page);
    if (page.length < 100) break;
  }
  const out = {};
  for (const ev of events) {
    const parts = ev.slug.split('-');
    if (parts[0] !== lg || ev.slug.endsWith('props') || parts.length < 6) continue;
    const m = ev.markets?.find(x => x.sportsMarketType === 'moneyline' && x.active && !x.closed);
    if (!m || !m.acceptingOrders) continue;
    const start = ev.startTime || m.gameStartTime;
    if (!start || new Date(start) < new Date()) continue;
    const away = canon(lg, parts[1]), home = canon(lg, parts[2]);
    const bid = Number(m.bestBid), ask = Number(m.bestAsk);
    if (!(ask > 0 && ask < 1 && bid > 0 && bid < 1)) continue;
    const rate = m.feesEnabled ? Number(m.feeSchedule?.rate ?? 0) : 0;
    const tokens = JSON.parse(m.clobTokenIds || '[]');
    // Outcome 0 is the first team in the slug (the away side). Buying the other
    // outcome costs 1 - bestBid of outcome 0 because the two books mirror each other.
    const pA = ask, pB = 1 - bid;
    out[gameKey(lg, away, home, start)] = {
      label: 'Polymarket', slug: ev.slug, feeRate: rate, liquidity: Number(m.liquidityNum) || 0,
      tokens: { a: tokens[0], b: tokens[1] },
      a: { cost: pA + polyFee(pA, rate), price: pA, fee: polyFee(pA, rate) },
      b: { cost: pB + polyFee(pB, rate), price: pB, fee: polyFee(pB, rate) },
      fairA: (bid + ask) / 2,
      url: `https://polymarket.com/event/${ev.slug}`,
    };
  }
  return out;
}

// ---------- Kalshi (public trade API, one binary market per team) ----------
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
export function parseKalshiDate(eventTicker) {
  const m = /-(\d{2})([A-Z]{3})(\d{2})/.exec(eventTicker);
  if (!m) return null;
  const d = new Date(Date.UTC(2000 + +m[1], MONTHS[m[2]], +m[3]));
  return d.toISOString().slice(0, 10);
}

export async function kalshi(lg) {
  const L = LEAGUES[lg];
  const data = await getJSON(`https://api.elections.kalshi.com/trade-api/v2/events?limit=200&status=open&series_ticker=${L.kalshi}&with_nested_markets=true`);
  const out = {};
  for (const ev of data.events || []) {
    const date = parseKalshiDate(ev.event_ticker);
    const mk = (ev.markets || []).filter(m => m.status === 'active' || m.status === 'open' || !m.status);
    if (!date || mk.length !== 2) continue;
    // Event ticker ends with AWAYHOME. Market tickers end with each team's code.
    const tail = ev.event_ticker.split('-')[1].replace(/^\d{2}[A-Z]{3}\d{2}(\d{4})?/, '');
    const codes = mk.map(m => m.ticker.split('-').pop());
    const awayRaw = codes.find(c => tail.startsWith(c));
    const homeRaw = codes.find(c => c !== awayRaw);
    if (!awayRaw || !homeRaw) continue;
    const mA = mk.find(m => m.ticker.endsWith('-' + awayRaw));
    const mH = mk.find(m => m.ticker.endsWith('-' + homeRaw));
    const num = v => (v == null || v === '' ? NaN : Number(v));
    // Two ways to back a team: YES on its market, or NO on the opponent's.
    const side = (yesM, noM) => {
      const routes = [
        { price: num(yesM.yes_ask_dollars), size: num(yesM.yes_ask_size_fp), via: 'YES ' + yesM.ticker },
        { price: num(noM.no_ask_dollars), size: NaN, via: 'NO ' + noM.ticker },
      ].filter(r => r.price > 0 && r.price < 1).sort((x, y) => x.price - y.price);
      const r = routes[0];
      if (!r) return null;
      return { cost: r.price + kalshiFee(r.price), price: r.price, fee: kalshiFee(r.price), size: r.size, via: r.via };
    };
    const a = side(mA, mH), b = side(mH, mA);
    if (!a || !b) continue;
    const bid = num(mA.yes_bid_dollars), ask = num(mA.yes_ask_dollars);
    const key = `${lg}:${canon(lg, awayRaw)}@${canon(lg, homeRaw)}:${date}`;
    out[key] = {
      label: 'Kalshi', event: ev.event_ticker, tickers: { a: mA.ticker, b: mH.ticker },
      a, b,
      fairA: bid > 0 && ask > 0 ? (bid + ask) / 2 : a.price,
      url: `https://kalshi.com/markets/${L.kalshi.toLowerCase()}`,
    };
  }
  return out;
}
