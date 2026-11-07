import 'dotenv/config';

export type Network = 'mainnet' | 'testnet';
export type PaymentsMode = 'off' | 'dry' | 'live';
export type TradeMode = 'off' | 'paper' | 'live';
export type AnchorMode = 'off' | 'dry' | 'live';

const env = process.env;

function choice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = env[key];
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function number(key: string, fallback: number): number {
  const value = Number(env[key]);
  return env[key] !== undefined && Number.isFinite(value) ? value : fallback;
}

function text(key: string, fallback = ''): string {
  return env[key]?.trim() || fallback;
}

export const config = {
  port: number('PORT', 8787),
  dbPath: text('DB_PATH', './data/sibyl.db'),

  /** Voices and DeepBook prices are read here (free, read-only). */
  readNetwork: choice<Network>('SUI_READ_NETWORK', ['mainnet', 'testnet'], 'mainnet'),
  /** Anchors, MPP payments and trades are sent here. */
  writeNetwork: choice<Network>('SUI_WRITE_NETWORK', ['mainnet', 'testnet'], 'testnet'),
  tatumKey: text('TATUM_API_KEY'),

  memwalKey: text('MEMWAL_KEY'),
  memwalAccount: text('MEMWAL_ACCOUNT_ID'),
  memwalUrl: text('MEMWAL_SERVER_URL', 'https://relayer.memory.walrus.xyz'),

  traderKey: text('TRADER_PRIVATE_KEY'),
  buyerKey: text('BUYER_PRIVATE_KEY'),
  analystRecipient: text('ANALYST_RECIPIENT_ADDRESS'),
  /** HMAC key that binds MPP payment challenges to their contents (any random 32 bytes). */
  mppSecret: text('MPP_SECRET_KEY'),
  packageId: text('SIBYL_PACKAGE_ID'),

  polymarket: env.ENABLE_POLYMARKET === 'true',

  paymentsMode: choice<PaymentsMode>('PAYMENTS_MODE', ['off', 'dry', 'live'], 'dry'),
  tradeMode: choice<TradeMode>('TRADE_MODE', ['off', 'paper', 'live'], 'paper'),
  anchorMode: choice<AnchorMode>('ANCHOR_MODE', ['off', 'dry', 'live'], 'dry'),

  maxStake: number('MAX_STAKE_USDC', 1),
  maxDailyStake: number('MAX_DAILY_USDC', 20),
  maxPayment: number('MAX_PAYMENT_USDC', 0.05),
  maxDailyPayments: number('MAX_DAILY_PAYMENTS_USDC', 3),
  /**
   * value: buy an analyst only when memory says its signal is worth the price (plus 10% exploration).
   * always: buy every analyst on every paid call (within the caps); memory's valuation is still shown.
   */
  buyPolicy: choice<'value' | 'always'>('BUY_POLICY', ['value', 'always'], 'value'),
};

function ensure(condition: unknown, message: string) {
  if (!condition) throw new Error(`config: ${message}`);
}

const live = (mode: string) => mode === 'live';
if (live(config.paymentsMode)) {
  ensure(config.buyerKey, 'live payments need BUYER_PRIVATE_KEY');
  ensure(config.analystRecipient, 'live payments need ANALYST_RECIPIENT_ADDRESS');
  ensure(config.mppSecret, 'live payments need MPP_SECRET_KEY (openssl rand -hex 32)');
}
if (live(config.tradeMode)) ensure(config.traderKey, 'live trading needs TRADER_PRIVATE_KEY');
if (live(config.anchorMode)) {
  ensure(config.traderKey, 'live anchors need TRADER_PRIVATE_KEY');
  ensure(config.packageId, 'live anchors need SIBYL_PACKAGE_ID (pnpm publish:move)');
}

/** Suiscan link for a transaction on the write network. */
export const txUrl = (digest: string) => `https://suiscan.xyz/${config.writeNetwork}/tx/${digest}`;
