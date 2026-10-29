import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const scenario = args.find((value) => value.startsWith('--scenario='))?.split('=')[1];
if (!scenario || !['A', 'B', 'D', 'E'].includes(scenario)) {
  process.stderr.write('Supported scenarios: A, B, D, E.\n');
  process.exit(2);
}
const file =
  scenario === 'A' ? 'src/test/scenarios/phase4.ts' : 'src/test/integration/phase7.test.ts';
const result = spawnSync(
  process.execPath,
  ['--conditions=react-server', '--env-file-if-exists=.env', '--import', 'tsx', file, ...args],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
