import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';

import { ROUTE_PERMISSIONS } from '@/lib/rbac';

function routeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : [];
  });
}

export function assertRouteCoverage(root = join(process.cwd(), 'src', 'app', 'api')): void {
  if (!existsSync(root)) throw new Error('API route source directory unavailable.');
  const actual = routeFiles(root).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const pattern = `/${relative(root, file)
      .split(sep)
      .slice(0, -1)
      .map((part) =>
        part.startsWith('[...') ? '*' : part.startsWith('[') ? `:${part.slice(1, -1)}` : part,
      )
      .join('/')}`;
    return [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\s*=/g)].map(
      (match) => `${match[1]} /api${pattern}`,
    );
  });
  const listed = ROUTE_PERMISSIONS.map((entry) => `${entry.method} ${entry.pattern}`);
  const missing = actual.filter((entry) => !listed.includes(entry));
  const extra = listed.filter((entry) => !actual.includes(entry));
  if (missing.length || extra.length)
    throw new Error(
      `Route coverage mismatch: missing=${missing.join(',')} extra=${extra.join(',')}`,
    );
}
