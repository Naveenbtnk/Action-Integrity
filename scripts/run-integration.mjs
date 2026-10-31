import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
for (const file of [
  'src/test/integration/systems.test.ts',
  'src/test/integration/phase4.test.ts',
  'src/test/integration/phase5.test.ts',
  'src/test/integration/phase6.test.ts',
  'src/test/integration/phase7.test.ts',
]) {
  // These fixtures assert the deterministic baseline even when local development uses Gemini.
  const result = spawnSync(
    process.execPath,
    ['--conditions=react-server', '--env-file-if-exists=.env', '--import', 'tsx', file, ...args],
    { stdio: 'inherit', env: { ...process.env, INVESTIGATION_MODE: 'deterministic' } },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
