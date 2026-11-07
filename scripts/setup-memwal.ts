import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { generateDelegateKey } from '@mysten-incubation/memwal/account';
const path = './.memwal-delegate-key';
const delegate = await generateDelegateKey();
writeFileSync(path, delegate.privateKey + '\n', { mode: 0o600, flag: 'wx' });
console.log(`Delegate public key: ${Buffer.from(delegate.publicKey).toString('hex')}`);
console.log(`Delegate address: ${delegate.suiAddress}`);
console.log(
  `Private key saved to ${path} (mode 0600). Register the public key in memory.walrus.xyz and set MEMWAL_KEY from the file; set MEMWAL_ACCOUNT_ID to the account object ID.`,
);
