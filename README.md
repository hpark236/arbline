# xvenue-arb

Compares tennis and golf prices on Polymarket, Kalshi and Pinnacle and flags two-leg arbitrage.

Live: https://xvenue-arb.vercel.app

## How it works

- Every price is converted to the cost, including fees, of a contract that pays $1.
- **Tennis** (ATP, WTA, Challenger): match winner. "Player does not win" can be bought as a No contract on Kalshi or as the opponent winning on any venue.
- **Golf** (PGA, LPGA, DP World, LIV): tournament winner, compared player by player. Pinnacle only offers "to win"; Polymarket and Kalshi offer both Yes and No.
- If the cheapest Yes and the cheapest No for a player cost less than $1 together, the payout is the same whatever happens.
- Clicking a row lists every pairing, splits a stake for equal payout, and checks the live Polymarket and Kalshi order books to see how much would actually fill.

Fees: Polymarket `shares × rate × p × (1 − p)` with each market's rate; Kalshi `0.07 × p × (1 − p)`, rounded up per order. Pinnacle prices are `1 / decimal odds`.

Players are matched across venues by surname and first initial (accents and hyphens removed), tournaments by tour and name.

## Data

Polymarket Gamma and CLOB APIs, Kalshi public API, and Pinnacle's public guest API (the same one its website uses for logged-out visitors). No keys needed. The API runs in Vercel's Singapore region.

## Files

```
api/board.js   fetch and join all venues
api/depth.js   order book for one Polymarket token or Kalshi market
lib/feeds.js   venue adapters and name matching
lib/core.js    pricing math (shared with the browser)
test/          unit tests
```

```bash
npm test
npx vercel dev
```

Not betting advice.
