import { LEAGUES, sportsbook, polymarket, kalshi } from '../lib/feeds.js';
import { analyseGame } from '../lib/core.js';

// GET /api/board?league=nfl,mlb  ->  every upcoming game quoted on at least two venues
export default async function handler(req, res) {
  const wanted = String(req.query?.league || Object.keys(LEAGUES).join(','))
    .split(',').filter(l => LEAGUES[l]);
  const status = {};
  const games = [];

  await Promise.all(wanted.map(async lg => {
    const [book, poly, kal] = await Promise.allSettled([sportsbook(lg), polymarket(lg), kalshi(lg)]);
    const pick = (name, r) => {
      status[`${lg}.${name}`] = r.status === 'fulfilled' ? Object.keys(r.value).length : `error: ${r.reason?.message || r.reason}`;
      return r.status === 'fulfilled' ? r.value : {};
    };
    const B = pick('book', book), P = pick('poly', poly), K = pick('kalshi', kal);
    for (const key of Object.keys(B)) {
      const g = B[key];
      const venues = { book: g.book || null, poly: P[key] || null, kalshi: K[key] || null };
      const quoted = Object.values(venues).filter(Boolean).length;
      if (quoted < 2) continue;
      games.push({
        key, league: lg, start: g.start, away: g.away, home: g.home,
        venues, quoted, analysis: analyseGame(venues),
      });
    }
  }));

  games.sort((x, y) => (x.analysis.best?.sum ?? 9) - (y.analysis.best?.sum ?? 9));
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  res.status(200).json({ updated: new Date().toISOString(), status, games });
}
