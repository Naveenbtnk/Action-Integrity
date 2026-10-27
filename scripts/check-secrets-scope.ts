import { readFile } from 'node:fs/promises';
import path from 'node:path';

const restricted = [
  '@google/genai',
  'AGENT_SERVICE_KEY',
  'TARGET_SERVICE_KEY',
  'OPS_SERVICE_KEY',
  'GEMINI_API_KEY',
];
const clientRoots = ['src/app', 'src/components'];
const findings: string[] = [];

async function walk(directory: string): Promise<void> {
  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const source = await readFile(absolute, 'utf8');
      if (source.includes("'use client'") || source.includes('"use client"')) {
        for (const token of restricted)
          if (source.includes(token)) findings.push(`${absolute}: ${token}`);
      }
    }
  }
}

for (const root of clientRoots) await walk(path.resolve(process.cwd(), root));

if (findings.length > 0) {
  process.stderr.write(`Client secret-scope violation:\n${findings.join('\n')}\n`);
  process.exit(1);
}
