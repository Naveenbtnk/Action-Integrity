import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const grep = args.indexOf('--grep');
if (grep >= 0) args.splice(grep, 1, '-t');
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'src/test/unit', 'src/test/envelope', ...args],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
