import { pinnacleTennis, kalshiTennis, polyTennis, joinTennis, pinnacleGolf, kalshiGolf, polyGolf, joinGolf } from '../lib/feeds.js';
import { analyseEvent } from '../lib/core.js';

// GET /api/board -> tennis matches and golf tournaments quoted on at least two venues
export default async function handler(req, res) {
  const status = {};
  const run = async (name, fn) => {
    try { const v = await fn(); status[name] = v.length; return v; }
    catch (e) { status[name] = 'error: ' + (e.message || e); return []; }
  };
  const [pt, kt, yt, pg, kg, yg] = await Promise.all([
    run('tennis.pinnacle', pinnacleTennis), run('tennis.kalshi', kalshiTennis), run('tennis.poly', polyTennis),
    run('golf.pinnacle', pinnacleGolf), run('golf.kalshi', kalshiGolf), run('golf.poly', polyGolf),
  ]);
  const shape = ev => {
    const a = analyseEvent(ev);
    return { ...ev, analysis: a };
  };
  const tennis = joinTennis({ pinnacle: pt, kalshi: kt, poly: yt })
    .map(shape).filter(e => e.analysis.venues.length >= 2 && e.analysis.best)
    .sort((a, b) => a.analysis.best.sum - b.analysis.best.sum);
  const golf = joinGolf({ pinnacle: pg, kalshi: kg, poly: yg })
    .map(shape).filter(e => e.analysis.venues.length >= 2)
    // longshots under 1% have no real size behind them, so only rank players the market gives a chance
    .map(e => ({ ...e, outcomes: e.outcomes.filter(o => Object.keys(o.venues).length >= 2 && Math.max(0, ...Object.values(o.implied)) >= 0.01).sort((a, b) => (a.best?.sum ?? 9) - (b.best?.sum ?? 9)) }))
    .filter(e => e.outcomes.length);
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=90');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ updated: new Date().toISOString(), status, tennis, golf });
}
