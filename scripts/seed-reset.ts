import 'dotenv/config';

import { db } from '../src/lib/db';

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error('DATABASE_URL is required.');
if (process.env.DIRECT_DATABASE_URL && process.env.DIRECT_DATABASE_URL !== rawUrl) {
  throw new Error('Seed reset refused: DATABASE_URL and DIRECT_DATABASE_URL must match.');
}
const target = new URL(rawUrl);
const databaseName = decodeURIComponent(target.pathname.slice(1));
const explicitlyAllowed =
  process.env.ALLOW_DB_RESET === 'true' || process.env.ALLOW_DB_RESET === '1';
const localHost = ['localhost', '127.0.0.1'].includes(target.hostname);

if (
  process.env.NODE_ENV === 'production' ||
  (!databaseName.endsWith('_test') && !(explicitlyAllowed && localHost))
) {
  throw new Error(
    'Seed reset refused: use a *_test database or set ALLOW_DB_RESET=1 for a local database.',
  );
}

try {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  if (tables.length === 0) throw new Error('Seed reset refused: no application tables found.');
  const quoted = tables.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  process.stdout.write(`Reset ${tables.length} application tables in ${databaseName}.\n`);
} finally {
  await db.$disconnect();
}

await import('../prisma/seed');
