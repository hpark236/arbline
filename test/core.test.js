import test from 'node:test';
import assert from 'node:assert/strict';
import { americanToDecimal, decimalToAmerican, devig, kalshiFee, kalshiOrderFee, polyFee, twoWay, stakePlan, analyseGame, walkDepth } from '../lib/core.js';
import { canon, parseKalshiDate, etDate } from '../lib/feeds.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('american odds convert both ways', () => {
  close(americanToDecimal('+124'), 2.24);
  close(americanToDecimal(-148), 1 + 100 / 148);
  assert.equal(americanToDecimal('EVEN'), null);
  assert.equal(decimalToAmerican(2.24), 124);
  assert.equal(decimalToAmerican(1 + 100 / 148), -148);
});

test('devig sums to one and keeps the favourite on top', () => {
  const d = devig(1 / 1.6757, 1 / 2.24);
  close(d.a + d.b, 1);
  assert.ok(d.a > d.b);
  assert.ok(d.overround > 0.03 && d.overround < 0.05);
  const p = devig(0.8, 0.25, 'power');
  close(p.a + p.b, 1, 1e-6);
  assert.ok(p.b < 0.25 / 1.05, 'power method shades the longshot harder');
});

test('fees match the venues\' published tables', () => {
  // Polymarket sports table: 100 shares at $0.50 with rate 0.05 costs $1.25
  close(100 * polyFee(0.5, 0.05), 1.25);
  close(100 * polyFee(0.3, 0.07), 1.47);
  // Kalshi: 0.07 x C x P x (1-P), rounded up to the cent per order
  close(kalshiFee(0.5), 0.0175);
  assert.equal(kalshiOrderFee(0.5, 1), 0.02);
  assert.equal(kalshiOrderFee(0.5, 100), 1.75);
});

test('two-way arb detection and equal-payout staking', () => {
  const t = twoWay(0.47, 0.5);
  assert.ok(t.isArb);
  close(t.roi, 1 / 0.97 - 1);
  const s = stakePlan(970, 0.47, 0.5);
  close(s.payout, 1000); close(s.profit, 30);
  close(s.stakeA + s.stakeB, 970);
  assert.ok(!twoWay(0.52, 0.5).isArb);
});

test('analyseGame picks the cheapest leg on each side', () => {
  const g = analyseGame({
    book: { a: { cost: 0.55 }, b: { cost: 0.5 }, fairA: 0.52 },
    poly: { a: { cost: 0.48 }, b: { cost: 0.54 }, fairA: 0.47 },
    kalshi: null,
  });
  assert.equal(g.bestA.venue, 'poly');
  assert.equal(g.bestB.venue, 'book');
  close(g.best.sum, 0.98);
  assert.equal(g.pairs[0].legA, 'poly');
  close(g.spreadPts, 5);
});

test('depth walk stops at the first unprofitable level', () => {
  const r = walkDepth([[0.45, 100], [0.48, 100]], [[0.5, Infinity]]);
  close(r.claims, 200); close(r.profit, 200 - (100 * 0.95 + 100 * 0.98));
  const r2 = walkDepth([[0.45, 100], [0.52, 100]], [[0.5, 1000]]);
  close(r2.claims, 100);
  const r3 = walkDepth([[0.5, 100]], [[0.5, 100]], p => kalshiFee(p));
  close(r3.claims, 0);
});

test('team codes and dates line up across venues', () => {
  assert.equal(canon('nfl', 'was'), 'WSH');
  assert.equal(canon('nhl', 'LAS'), 'VGK');
  assert.equal(canon('mlb', 'NYY'), 'NYY');
  assert.equal(parseKalshiDate('KXMLBGAME-26OCT031830NYYTB'), '2026-10-03');
  assert.equal(etDate('2026-10-02T00:15:00Z'), '2026-10-01');
});
