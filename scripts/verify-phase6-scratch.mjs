import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import pg from 'pg';

const name = `aic_phase6_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const original = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!original) throw new Error('DIRECT_DATABASE_URL or DATABASE_URL is required.');
const adminUrl = new URL(original);
adminUrl.pathname = '/postgres';
const scratchUrl = new URL(original);
scratchUrl.pathname = `/${name}`;
const administrator = new pg.Client({ connectionString: adminUrl.toString() });
await administrator.connect();

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    env: {
      ...process.env,
      DATABASE_URL: scratchUrl.toString(),
      DIRECT_DATABASE_URL: scratchUrl.toString(),
      SEED_PROFILE: 'test',
    },
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stderr.write(`${label} failed\n${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw result.error ?? new Error(`${label} exited ${result.status}`);
  }
  process.stdout.write(`${label}: passed\n`);
}

try {
  await administrator.query(`CREATE DATABASE "${name}"`);
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], 'fresh migrations');
  run(
    ['--conditions=react-server', '--env-file-if-exists=.env', '--import', 'tsx', 'prisma/seed.ts'],
    'fresh seed',
  );
  run(
    [
      '--conditions=react-server',
      '--env-file-if-exists=.env',
      '--import',
      'tsx',
      'src/test/integration/phase6.test.ts',
      'policy-activation',
    ],
    'approval invalidation on policy activation',
  );
} finally {
  await administrator.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await administrator.end();
  const anchorRoot = resolve(process.cwd(), 'var', 'anchors');
  const scratchAnchor = resolve(anchorRoot, name);
  if (!scratchAnchor.startsWith(`${anchorRoot}${sep}`))
    throw new Error('Scratch anchor path escaped its root.');
  await rm(scratchAnchor, { recursive: true, force: true });
}
