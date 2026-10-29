import type { Role } from '@/generated/prisma/enums';

import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & { id: string; sessionEpoch: number; roles: Role[] };
  }
}
