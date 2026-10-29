import 'dotenv/config';

import { randomBytes } from 'node:crypto';

import { hash } from 'bcryptjs';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

const allowed = new Set([
  'viewer@aic.local',
  'analyst@aic.local',
  'reviewer@aic.local',
  'reviewer2@aic.local',
  'senior@aic.local',
  'admin@aic.local',
  'auditor@aic.local',
]);

async function main() {
  if (env.NODE_ENV === 'production' || !env.AUTH_CREDENTIALS_ENABLED)
    throw new Error(
      'Local credential reset is available only in development with credentials enabled.',
    );
  const email = process.argv[2];
  if (!email || !allowed.has(email)) throw new Error('Choose a seeded local account.');
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error('Seeded account is missing. Run the seed first.');
  const password = randomBytes(24).toString('base64url');
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(password, 12), sessionEpoch: { increment: 1 } },
  });
  process.stdout.write(`Local development sign-in: ${email}\nPassword: ${password}\n`);
}

try {
  await main();
} finally {
  await db.$disconnect();
}
