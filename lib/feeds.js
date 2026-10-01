// Venue adapters for tennis and golf. Every venue is normalised into events whose
// outcomes are players, each with a "yes" quote (player wins) and, where the venue
// allows it, a "no" quote (player does not win). Prices are all-in cost per $1 claim.
import { americanToDecimal, kalshiFee, polyFee } from './core.js';

const UA = { 'User-Agent': 'arbline/2.0 (+https://github.com/hpark236/arbline)' };
async function getJSON(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- name matching ----------
export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
/** "Zachary Bauchou" and "Zach Bauchou" both become "bauchou z". */
export function playerKey(name) {
  const parts = fold(name).split(' ').filter(p => p && !['jr', 'sr', 'ii', 'iii'].includes(p));
  if (!parts.length) return '';
  return parts.at(-1) + ' ' + parts[0][0];
}
export const surname = name => fold(name).split(' ').filter(Boolean).at(-1) || '';

/** Tournament names differ by venue ("LPGA - LOTTE Championship Winner" vs "LOTTE Championship presented by Hoakalei Winner"). */
export function tournamentKey(name) {
  return fold(name)
    .replace(/presented by .*/, '')
    .replace(/\b(pga|lpga|liv|dp world|tour|golf|winner|champion|the|20\d\d)\b/g, ' ')
    .split(' ').filter(w => w.length > 1).sort().join(' ');
}
export function sameTournament(a, b) {
  const A = new Set(tournamentKey(a).split(' ')), B = new Set(tournamentKey(b).split(' '));
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / Math.max(1, Math.min(A.size, B.size)) >= 0.6;
}

const kQuote = p => (p > 0 && p < 1) ? { cost: p + kalshiFee(p), price: p, fee: kalshiFee(p) } : null;
const pQuote = (p, rate) => (p > 0 && p < 1) ? { cost: p + polyFee(p, rate), price: p, fee: polyFee(p, rate) } : null;
const bQuote = american => { const d = americanToDecimal(american); return d ? { cost: 1 / d, price: 1 / d, fee: 0, american } : null; };
const num = v => (v == null || v === '' ? NaN : Number(v));
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
export function parseKalshiDate(t) {
  const m = /-(\d{2})([A-Z]{3})(\d{2})/.exec(t);
  return m ? new Date(Date.UTC(2000 + +m[1], MONTHS[m[2]], +m[3], 12)).toISOString() : null;
}

// =============================== TENNIS ===============================
const PIN = 'https://guest.api.arcadia.pinnacle.com/0.1';
// Pinnacle's own web app sends this public guest key for logged-out visitors.
const PIN_KEY = { 'X-API-Key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R', Referer: 'https://www.pinnacle.com/' };

export async function pinnacleTennis() {
  const [mu, mk] = await Promise.all([
    getJSON(`${PIN}/sports/33/matchups?withSpecials=false`, PIN_KEY),
    getJSON(`${PIN}/sports/33/markets/straight?primaryOnly=true&withSpecials=false`, PIN_KEY),
  ]);
  const ml = new Map(mk.filter(m => m.type === 'moneyline' && m.period === 0 && !m.isAlternate).map(m => [m.matchupId, m]));
  const out = [];
  for (const m of mu) {
    if (m.type !== 'matchup' || m.parentId || m.isLive || /doubles/i.test(m.league?.name || '')) continue;
    const price = ml.get(m.id); if (!price) continue;
    const home = m.participants.find(p => p.alignment === 'home'), away = m.participants.find(p => p.alignment === 'away');
    const ph = price.prices.find(p => p.designation === 'home'), pa = price.prices.find(p => p.designation === 'away');
    if (!home || !away || !ph || !pa) continue;
    out.push({
      tour: (m.league.name.match(/^(ATP Challenger|ATP|WTA 125k|WTA|ITF Men|ITF Women)/i) || [m.league.name])[0],
      name: m.league.name, start: m.startTime,
      players: [{ name: home.name, yes: bQuote(ph.price) }, { name: away.name, yes: bQuote(pa.price) }],
    });
  }
  return out;
}

export async function kalshiTennis() {
  const series = ['KXATPMATCH', 'KXWTAMATCH', 'KXCHALLENGERMATCH'];
  const all = await Promise.all(series.map(s => getJSON(`https://api.elections.kalshi.com/trade-api/v2/events?limit=200&status=open&series_ticker=${s}&with_nested_markets=true`).catch(() => ({ events: [] }))));
  const out = [];
  all.forEach((j, i) => {
    for (const ev of j.events || []) {
      const mk = (ev.markets || []).filter(m => m.yes_sub_title);
      if (mk.length !== 2) continue;
      out.push({
        tour: { KXATPMATCH: 'ATP', KXWTAMATCH: 'WTA', KXCHALLENGERMATCH: 'ATP Challenger' }[series[i]],
        name: ev.title, start: parseKalshiDate(ev.event_ticker),
        players: mk.map(m => ({ name: m.yes_sub_title, yes: kQuote(num(m.yes_ask_dollars)), no: kQuote(num(m.no_ask_dollars)), ticker: m.ticker })),
      });
    }
  });
  return out;
}

export async function polyTennis() {
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const pages = await Promise.all([10365, 10366].flatMap(sid => [0, 100, 200].map(off =>
    getJSON(`https://gamma-api.polymarket.com/events?series_id=${sid}&closed=false&limit=100&offset=${off}&end_date_min=${since}`).catch(() => []))));
  const out = [];
  for (const ev of pages.flat()) {
    const m = ev.markets?.find(x => x.sportsMarketType === 'moneyline' && !x.closed && x.acceptingOrders);
    if (!m) continue;
    const start = ev.startTime || m.gameStartTime;
    if (!start || new Date(start) < Date.now()) continue;
    const names = JSON.parse(m.outcomes || '[]'), tokens = JSON.parse(m.clobTokenIds || '[]');
    const bid = num(m.bestBid), ask = num(m.bestAsk);
    if (names.length !== 2 || !(bid > 0 && ask > 0 && ask < 1)) continue;
    const rate = m.feesEnabled ? num(m.feeSchedule?.rate) || 0 : 0;
    // The two outcome books mirror each other: buying player 2 costs 1 - best bid on player 1.
    out.push({
      tour: ev.slug.startsWith('wta') ? 'WTA' : 'ATP', name: ev.title, start, slug: ev.slug,
      players: [
        { name: names[0], yes: pQuote(ask, rate), token: tokens[0], feeRate: rate },
        { name: names[1], yes: pQuote(1 - bid, rate), token: tokens[1], feeRate: rate },
      ],
      url: `https://polymarket.com/event/${ev.slug}`,
    });
  }
  return out;
}

/** Join the three venues' tennis matches by the pair of player keys and start time. */
export function joinTennis({ pinnacle = [], kalshi = [], poly = [] }) {
  const events = new Map();
  const add = (venue, list) => {
    for (const m of list) {
      const keys = m.players.map(p => playerKey(p.name));
      const id = [...keys].sort().join(' | ');
      // same pairing within two days is the same match (Kalshi only gives a date)
      let ev = [...(events.get(id) || [])].find(e => Math.abs(new Date(e.start) - new Date(m.start)) < 2 * 864e5);
      if (!ev) {
        ev = { key: 'tennis:' + id + ':' + m.start.slice(0, 10), sport: 'tennis', tour: m.tour, name: m.name, start: m.start, outcomes: keys.map((k, i) => ({ key: k, name: m.players[i].name, venues: {} })) };
        events.set(id, [...(events.get(id) || []), ev]);
      }
      if (venue !== 'kalshi' && !ev.exact) { ev.start = m.start; ev.exact = true; } // Kalshi only gives a date
      if (venue === 'pinnacle') ev.tour = m.tour;
      m.players.forEach(p => {
        const o = ev.outcomes.find(x => x.key === playerKey(p.name));
        if (o) o.venues[venue] = { yes: p.yes, no: p.no || null, ticker: p.ticker, token: p.token, feeRate: p.feeRate, url: m.url };
      });
    }
  };
  add('pinnacle', pinnacle); add('poly', poly); add('kalshi', kalshi);
  return [...events.values()].flat();
}

// =============================== GOLF ===============================
export async function pinnacleGolf() {
  const [mu, mk] = await Promise.all([
    getJSON(`${PIN}/sports/17/matchups?withSpecials=true`, PIN_KEY),
    getJSON(`${PIN}/sports/17/markets/straight?primaryOnly=false&withSpecials=true`, PIN_KEY),
  ]);
  const byId = new Map(mk.map(m => [m.matchupId, m]));
  const out = [];
  for (const m of mu) {
    if (m.type !== 'special' || !/winner/i.test(m.special?.description || '') || m.participants.length < 10) continue;
    const prices = byId.get(m.id)?.prices || [];
    out.push({
      tour: m.league.name.split(' - ')[0], name: m.special.description.replace(/ winner$/i, '').replace(/^.* - /, ''),
      start: m.startTime,
      players: m.participants.map(p => ({ name: p.name, yes: bQuote(prices.find(x => x.participantId === p.id)?.price) })).filter(p => p.yes),
    });
  }
  return out;
}

export async function kalshiGolf() {
  const series = { KXPGATOUR: 'PGA', KXLPGATOUR: 'LPGA', KXDPWORLDTOUR: 'DP World', KXLIVTOUR: 'LIV' };
  const out = [];
  await Promise.all(Object.entries(series).map(async ([s, tour]) => {
    const j = await getJSON(`https://api.elections.kalshi.com/trade-api/v2/events?limit=20&status=open&series_ticker=${s}&with_nested_markets=true`).catch(() => ({ events: [] }));
    for (const ev of j.events || []) {
      const mk = (ev.markets || []).filter(m => m.yes_sub_title);
      if (mk.length < 10) continue;
      out.push({
        tour, name: ev.title.replace(/ winner$/i, ''), start: null, event: ev.event_ticker,
        players: mk.map(m => ({ name: m.yes_sub_title, yes: kQuote(num(m.yes_ask_dollars)), no: kQuote(num(m.no_ask_dollars)), ticker: m.ticker })),
      });
    }
  }));
  return out;
}

export async function polyGolf() {
  const series = { 10976: 'PGA', 12419: 'LPGA', 12420: 'DP World', 12421: 'LIV' };
  const since = new Date(Date.now() - 4 * 864e5).toISOString();
  const out = [];
  await Promise.all(Object.entries(series).map(async ([sid, tour]) => {
    const evs = await getJSON(`https://gamma-api.polymarket.com/events?series_id=${sid}&closed=false&limit=50&end_date_min=${since}`).catch(() => []);
    for (const ev of evs) {
      if (!/winner/i.test(ev.title) || /top \d+/i.test(ev.title)) continue;
      const players = [];
      for (const m of ev.markets || []) {
        if (m.closed || !m.acceptingOrders || !m.groupItemTitle) continue;
        const bid = num(m.bestBid), ask = num(m.bestAsk), rate = m.feesEnabled ? num(m.feeSchedule?.rate) || 0 : 0;
        const tokens = JSON.parse(m.clobTokenIds || '[]');
        players.push({ name: m.groupItemTitle, yes: pQuote(ask, rate), no: bid > 0 ? pQuote(1 - bid, rate) : null, token: tokens[0], noToken: tokens[1], feeRate: rate });
      }
      if (players.length >= 10) out.push({ tour, name: ev.title.replace(/^[^:]*:\s*/, '').replace(/ winner$/i, ''), start: ev.startDate, slug: ev.slug, url: `https://polymarket.com/event/${ev.slug}`, players });
    }
  }));
  return out;
}

/** Join golf tournaments by tour and fuzzy name, then players by name key. */
export function joinGolf({ pinnacle = [], kalshi = [], poly = [] }) {
  const events = [];
  const add = (venue, list) => {
    for (const t of list) {
      let ev = events.find(e => e.tour === t.tour && sameTournament(e.name, t.name));
      if (!ev) { ev = { key: 'golf:' + tournamentKey(t.name).replace(/ /g, '-'), sport: 'golf', tour: t.tour, name: t.name, start: t.start, outcomes: [] }; events.push(ev); }
      if (!ev.start && t.start) ev.start = t.start;
      for (const p of t.players) {
        const k = playerKey(p.name);
        let o = ev.outcomes.find(x => x.key === k);
        if (!o) { o = { key: k, name: p.name, venues: {} }; ev.outcomes.push(o); }
        o.venues[venue] = { yes: p.yes, no: p.no || null, ticker: p.ticker, token: p.token, noToken: p.noToken, feeRate: p.feeRate, url: t.url };
      }
    }
  };
  add('pinnacle', pinnacle); add('poly', poly); add('kalshi', kalshi);
  return events;
}
