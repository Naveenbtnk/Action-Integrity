import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';
import { env } from '@/lib/env';
import { ImmutableRecordError } from '@/lib/errors';

const IMMUTABLE_MODELS = new Set([
  'AuditEvent',
  'AuditAnchor',
  'InvestigationReport',
  'VerificationResult',
  'EscalationEvent',
  'TgtAudit',
]);
const MUTATION_OPERATIONS = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

export function assertRecordMutable(model: string, operation = 'update'): void {
  if (IMMUTABLE_MODELS.has(model) && MUTATION_OPERATIONS.has(operation)) {
    throw new ImmutableRecordError(model);
  }
}

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter }).$extends({
    name: 'immutable-record-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model) assertRecordMutable(model, operation);
          if (model === 'PolicyVersion' && MUTATION_OPERATIONS.has(operation)) {
            if (operation === 'delete' || operation === 'deleteMany' || operation === 'upsert') {
              throw new ImmutableRecordError(model);
            }
            const data = (args as { data?: Record<string, unknown> }).data;
            if (data && ['document', 'hash', 'version'].some((key) => key in data)) {
              throw new ImmutableRecordError(model);
            }
          }
          return query(args);
        },
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
