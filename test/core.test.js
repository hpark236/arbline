import test from 'node:test';
import assert from 'node:assert/strict';
import { americanToDecimal, decimalToAmerican, devig, kalshiFee, kalshiOrderFee, polyFee, twoWay, stakePlan, walkDepth, outcomePairs, analyseEvent } from '../lib/core.js';
import { playerKey, tournamentKey, sameTournament, parseKalshiDate, joinTennis, joinGolf } from '../lib/feeds.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('american odds convert both ways', () => {
  close(americanToDecimal('+120'), 2.2);
  close(americanToDecimal(-138), 1 + 100 / 138);
  assert.equal(americanToDecimal('EVEN'), null);
  assert.equal(decimalToAmerican(2.2), 120);
});

test('devig sums to one', () => {
  const d = devig(1 / 1.7246, 1 / 2.2);
  close(d.a + d.b, 1);
  assert.ok(d.overround > 0);
});

test('fees match the venues\' published tables', () => {
  close(100 * polyFee(0.5, 0.05), 1.25); // Polymarket sports table
  close(kalshiFee(0.5), 0.0175);
  assert.equal(kalshiOrderFee(0.5, 100), 1.75);
  assert.equal(kalshiOrderFee(0.5, 1), 0.02); // rounded up per order
});

test('two-leg pricing and equal-payout stakes', () => {
  const t = twoWay(0.47, 0.5);
  assert.ok(t.isArb); close(t.roi, 1 / 0.97 - 1);
  const s = stakePlan(970, 0.47, 0.5);
  close(s.payout, 1000); close(s.profit, 30);
});

test('depth walk stops at the first unprofitable level', () => {
  close(walkDepth([[0.45, 100], [0.48, 100]], [[0.5, Infinity]]).claims, 200);
  close(walkDepth([[0.45, 100], [0.52, 100]], [[0.5, 1000]]).claims, 100);
  close(walkDepth([[0.5, 100]], [[0.5, 100]], p => kalshiFee(p)).claims, 0);
});

test('player names line up across venues', () => {
  assert.equal(playerKey('Zachary Bauchou'), playerKey('Zach Bauchou'));
  assert.equal(playerKey('Pablo Carreño Busta'), playerKey('Pablo Carreno Busta'));
  assert.equal(playerKey('Felix Auger-Aliassime'), playerKey('Félix Auger Aliassime'));
  assert.notEqual(playerKey('Jannik Sinner'), playerKey('Carlos Alcaraz'));
});

test('tournament names line up across venues', () => {
  assert.ok(sameTournament('LOTTE Championship presented by Hoakalei', 'LPGA - LOTTE Championship Winner'));
  assert.ok(sameTournament('Bank of Utah Championship', '2026 Bank of Utah Championship'));
  assert.ok(!sameTournament('Bank of Utah Championship', 'Alfred Dunhill Links Championship'));
  assert.equal(parseKalshiDate('KXATPMATCH-26OCT01FILTIA').slice(0, 10), '2026-10-01');
});

const q = c => ({ cost: c, price: c, fee: 0 });

test('tennis: the opponent\'s yes counts as a no, and venues join by name', () => {
  const events = joinTennis({
    pinnacle: [{ tour: 'ATP', name: 'ATP Tokyo', start: '2026-10-03T00:00:00Z', players: [{ name: 'Carlos Alcaraz', yes: q(0.80) }, { name: 'Taylor Fritz', yes: q(0.24) }] }],
    poly: [{ tour: 'ATP', name: 'Tokyo', start: '2026-10-03T00:00:00Z', players: [{ name: 'Carlos Alcaraz', yes: q(0.79) }, { name: 'Taylor Fritz', yes: q(0.22) }] }],
    kalshi: [{ tour: 'ATP', name: 'Alcaraz vs Fritz', start: '2026-10-02T12:00:00Z', players: [{ name: 'Carlos Alcaraz', yes: q(0.81), no: q(0.20) }, { name: 'Taylor Fritz', yes: q(0.21), no: q(0.80) }] }],
  });
  assert.equal(events.length, 1);
  const ev = events[0], alc = ev.outcomes.find(o => /Alcaraz/.test(o.name));
  assert.deepEqual(Object.keys(alc.venues).sort(), ['kalshi', 'pinnacle', 'poly']);
  const pairs = outcomePairs(ev, alc);
  // cheapest: Alcaraz yes on Polymarket (0.79) + Alcaraz no on Kalshi (0.20)
  assert.equal(pairs[0].yes.venue, 'poly'); assert.equal(pairs[0].no.venue, 'kalshi'); close(pairs[0].sum, 0.99);
  assert.ok(pairs[0].isArb);
  assert.ok(pairs.every(p => p.yes.venue !== p.no.venue));
  assert.ok(analyseEvent(ev).best.sum <= 0.99 + 1e-9);
});

test('golf: per-player yes/no across venues', () => {
  const [ev] = joinGolf({
    pinnacle: [{ tour: 'LPGA', name: 'LOTTE Championship', players: [{ name: 'Jeeno Thitikul', yes: q(0.14) }] }],
    kalshi: [{ tour: 'LPGA', name: 'LOTTE Championship presented by Hoakalei', players: [{ name: 'Jeeno Thitikul', yes: q(0.16), no: q(0.85) }] }],
  });
  const o = ev.outcomes[0];
  const a = analyseEvent(ev);
  close(o.best.sum, 0.99); assert.equal(o.best.yes.venue, 'pinnacle');
  assert.ok(a.best.isArb);
});
