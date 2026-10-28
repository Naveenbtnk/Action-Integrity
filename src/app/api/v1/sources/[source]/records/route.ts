import { z } from 'zod';

import { enforceAdapterLimit } from '@/lib/adapters/rate-limit';
import { getSource, isSourceKey } from '@/lib/adapters/registry';
import { ValidationError } from '@/lib/errors';
import { successResponse, withRoute } from '@/lib/http';
import { requirePermission } from '@/lib/rbac';
import { requireAgentKey } from '@/lib/target/auth';

const Query = z.object({
  accountId: z.string().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = withRoute(async (request, context) => {
  requireAgentKey(request);
  requirePermission({ service: 'SERVICE_AGENT' }, 'service:source_read');
  const source = new URL(request.url).pathname.split('/').at(-2) ?? '';
  if (!isSourceKey(source)) throw new ValidationError('Unknown source.');
  const url = new URL(request.url);
  const query = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) throw new ValidationError('Invalid source query.');
  await enforceAdapterLimit('sources', query.data.accountId);
  const records = await getSource(source).fetchRecords(query.data);
  return successResponse({ source, records }, context);
});
