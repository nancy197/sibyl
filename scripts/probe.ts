/**
 * Check every external dependency once and print what works.
 *   pnpm probe
 */
import { config } from '../src/config.js';
import { memoryHealth, memoryMode } from '../src/brain/memwal.js';
import { kalshiMarkets } from '../src/sources/kalshi.js';
import { candles, sigmaPerMinute, spotPrice } from '../src/sources/spot.js';
import { markets } from '../src/sources/deepbook.js';
import { readSui, tatum, writeSui } from '../src/sui.js';

const checks: [string, () => Promise<unknown>][] = [
  [
    `DeepBook markets (${config.readNetwork})`,
    async () =>
      (await markets()).map((m) => ({
        expiry: new Date(Number(m.expiryMs)).toISOString(),
        reference: m.referencePrice,
      })),
  ],
  [`Sui ${config.readNetwork} gas price`, () => readSui.getReferenceGasPrice()],
  [`Sui ${config.writeNetwork} gas price`, () => writeSui.getReferenceGasPrice()],
  ['Kalshi BTC markets', async () => (await kalshiMarkets()).length],
  [
    'Coinbase candles',
    async () => {
      const c = await candles();
      return { spot: spotPrice(c), sigmaPerMinute: sigmaPerMinute(c) };
    },
  ],
  [`Walrus Memory (${memoryMode})`, memoryHealth],
];

for (const [name, check] of checks) {
  try {
    console.log('ok  ', name, JSON.stringify(await check()));
  } catch (error) {
    console.log('FAIL', name, String(error));
  }
}
console.log('Tatum calls', tatum.calls, 'throttled', tatum.throttled);
process.exit(0);
