import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../src/lib/canonical-json';

const version = process.env.POLICY_VERSION ?? '2026.10.2';
const directory = process.env.POLICY_DIR ?? 'config/policy';
const contents = JSON.parse(
  await readFile(path.resolve(process.cwd(), directory, `${version}.json`), 'utf8'),
);
process.stdout.write(
  `sha256:${createHash('sha256').update(canonicalJson(contents)).digest('hex')}\n`,
);
