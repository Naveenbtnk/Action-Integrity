import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
for (const file of [
  'src/test/integration/systems.test.ts',
  'src/test/integration/phase4.test.ts',
]) {
  const result = spawnSync(
    process.execPath,
    ['--conditions=react-server', '--env-file-if-exists=.env', '--import', 'tsx', file, ...args],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
