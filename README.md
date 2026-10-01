# Arbline

Live cross-venue moneyline scanner. Every upcoming NFL, MLB, NBA and NHL game is priced on **Polymarket**, **Kalshi** and a **DraftKings** line, converted to the same unit (the all-in cost of a claim that pays $1 if a team wins), and checked for two-leg arbitrage.

**Live:** https://arbline.vercel.app

## What it does

- Pulls three venues server-side with no API keys: Polymarket Gamma API, Kalshi public trade API, and DraftKings moneylines from ESPN's public scoreboard.
- Matches games across venues by canonical team code and New York calendar date (each venue uses different codes, e.g. `WAS` / `WSH`, `LAS` / `VGK`).
- Adds each venue's real taker fee: Polymarket `C × rate × p × (1 − p)` with the rate read from each market's fee schedule, Kalshi `0.07 × p × (1 − p)`.
- For Kalshi, prices both routes to backing a team (YES on that team, or NO on the opponent) and uses the cheaper one.
- Ranks every cross-venue pairing. A pair summing below 1.000 locks a profit whoever wins.
- **Depth check:** opening a game fetches the live Polymarket CLOB and Kalshi order books and walks both ask ladders together, so the reported profit is what actually fills, not just top-of-book.
- Stake splitter for equal payout on either outcome, and a de-vigged comparison of each venue's implied probability.

## Layout

```
api/board.js   aggregate + analyse all leagues (cached 20s at the edge)
api/depth.js   order-book ladder for one Polymarket token or Kalshi market
lib/feeds.js   venue adapters and team-code normalisation
lib/core.js    pricing math, shared by server and browser
test/          node:test unit tests for the math and matching
index.html     the board (vanilla JS, no build step)
```

## Run it

```bash
npm test          # 7 tests: odds conversion, de-vig, fee tables, staking, depth walk, matching
npx vercel dev    # local server with the API routes
```

## Caveats

A sub-1.000 pair is necessary but not sufficient. Sportsbooks limit and restrict winning accounts, Kalshi rounds each order's fee up to the cent, capital is locked until settlement, and venues resolve edge cases (NFL ties, postponements) differently. Not betting advice.
