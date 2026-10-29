import { spawnSync } from 'node:child_process';

const requested = process.argv.slice(2);
const args = [
  '--conditions=react-server',
  '--env-file-if-exists=.env',
  'node_modules/@playwright/test/cli.js',
  'test',
];
if (requested.length > 0)
  args.push(
    '--grep',
    requested.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  );
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
