import { config } from './config.js';
import { log } from './log.js';
import { startServer } from './server.js';
import { startWorker } from './worker.js';

startServer();
log('info', 'Sibyl listening', {
  url: `http://localhost:${config.port}`,
  readNetwork: config.readNetwork,
  writeNetwork: config.writeNetwork,
  payments: config.paymentsMode,
  trade: config.tradeMode,
  anchor: config.anchorMode,
});
await startWorker();
