import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  [
    '--conditions=react-server',
    '--env-file-if-exists=.env',
    '--import',
    'tsx',
    'src/test/integration/phase7.test.ts',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
