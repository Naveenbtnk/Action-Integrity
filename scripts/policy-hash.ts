import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const version = process.env.POLICY_VERSION ?? '2026.10.1';
const directory = process.env.POLICY_DIR ?? 'config/policy';
const contents = await readFile(path.resolve(process.cwd(), directory, `${version}.json`));
process.stdout.write(`sha256:${createHash('sha256').update(contents).digest('hex')}\n`);
