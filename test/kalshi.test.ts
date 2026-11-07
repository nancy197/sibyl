import assert from 'node:assert/strict';
import test from 'node:test';
import { newEvent } from '../src/events.js';
import {
  kalshiEvents,
  kalshiProbability,
  kalshiQuote,
  type KalshiMarket,
} from '../src/sources/kalshi.js';

const close = '2030-01-01T00:15:00Z';
const market = (ticker: string, strike: number, bid: string, ask: string): KalshiMarket => ({
  ticker,
  event_ticker: ticker.split('-').slice(0, 2).join('-'),
  close_time: close,
  floor_strike: strike,
  yes_bid_dollars: bid,
  yes_ask_dollars: ask,
  last_price_dollars: '0.50',
});

test('probability is the mid of a tight book, else the last trade', () => {
  assert.ok(
    Math.abs(kalshiProbability(market('KXBTC15M-A-00', 1, '0.40', '0.44'))! - 0.42) < 1e-12,
  );
  assert.equal(kalshiProbability(market('KXBTC15M-A-00', 1, '0.10', '0.90')), 0.5);
});

test('quotes use the nearest strike at the same expiry; events come from the 15m series', () => {
  const book = [
    market('KXBTCD-B-T74000', 74_000, '0.80', '0.82'),
    market('KXBTCD-B-T75500', 75_500, '0.30', '0.32'),
  ];
  const e = newEvent('deepbook', '5m', Date.parse(close), 75_400, '0x1');
  assert.deepEqual(kalshiQuote(e, book), {
    voice: 'kalshi',
    p: 0.31,
    expiryMs: e.expiryMs,
    strike: 75_500,
    oracle: 'BRTI',
  });
  assert.equal(
    kalshiEvents([...book, market('KXBTC15M-26JAN-00', 75_000, '0.5', '0.5')]).length,
    1,
  );
});
