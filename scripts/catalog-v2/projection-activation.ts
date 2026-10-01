import path from 'node:path';
import { ActivationService } from '../../src/domain/catalog/projection-activation.js';
import { FileProjectionActivationStore } from '../../src/infra/catalog/file-projection-activation-store.js';

const [command, ...argv] = process.argv.slice(2);
const options: Record<string, string> = {};
for (const arg of argv) {
  const match = /^--(bundle|to|expected-active|actor|reason|root)=(.+)$/u.exec(arg);
  if (!match) throw new Error(`INVALID_ARGUMENT: ${arg}`);
  options[match[1]!] = match[2]!;
}
const service = new ActivationService(new FileProjectionActivationStore(path.resolve(options.root ?? 'artifacts/catalog-v2')));
const actor = { type: 'manual' as const, identity: options.actor ?? process.env.USERNAME ?? process.env.USER ?? 'local-operator' };
try {
  let result: unknown;
  if (command === 'activate') {
    if (!options.bundle) throw new Error('INVALID_ARGUMENT: --bundle is required');
    result = await service.activate(options.bundle, { actor, reason: options.reason ?? 'manual activation', expectedActiveBundleId: options['expected-active'] });
  } else if (command === 'rollback') result = await service.rollback({ to: options.to, actor, expectedActiveBundleId: options['expected-active'] });
  else if (command === 'status') result = await service.status(options.bundle);
  else throw new Error(`INVALID_ARGUMENT: ${command}`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', code: error instanceof Error && 'code' in error ? error.code : 'ACTIVATION_FAILED', message: String(error) }));
  process.exitCode = 1;
}
