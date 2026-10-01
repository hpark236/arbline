// GET /api/depth?venue=poly&id=<tokenId>   or   ?venue=kalshi&id=<marketTicker>&side=yes|no
// Returns the ask ladder for buying that claim, best price first: [[price, size], ...]
export default async function handler(req, res) {
  const { venue, id, side = 'yes' } = req.query || {};
  if (!id || !/^[\w.-]+$/.test(id)) return res.status(400).json({ error: 'bad id' });
  try {
    let asks = [];
    if (venue === 'poly') {
      const r = await fetch(`https://clob.polymarket.com/book?token_id=${id}`);
      const b = await r.json();
      asks = (b.asks || []).map(l => [Number(l.price), Number(l.size)]).sort((x, y) => x[0] - y[0]);
    } else if (venue === 'kalshi') {
      const r = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets/${id}/orderbook?depth=30`);
      const b = (await r.json()).orderbook_fp || {};
      // Kalshi lists bids only. Asking price for YES = 1 - a NO bid, and vice versa.
      const opp = side === 'yes' ? b.no_dollars : b.yes_dollars;
      asks = (opp || []).map(([p, q]) => [Math.round((1 - Number(p)) * 1e4) / 1e4, Number(q)]).sort((x, y) => x[0] - y[0]);
    } else return res.status(400).json({ error: 'venue must be poly or kalshi' });
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=20');
    res.status(200).json({ venue, id, side, asks: asks.slice(0, 40) });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
