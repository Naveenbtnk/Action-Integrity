import 'server-only';

import { compare } from 'bcryptjs';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import type { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

const allowedRoles = new Set<Role>([
  'VIEWER',
  'ANALYST',
  'REVIEWER',
  'SENIOR_REVIEWER',
  'ADMIN',
  'AUDITOR',
]);

function oidcRoles(profile: Record<string, unknown>): Role[] | null {
  const claims = profile[env.OIDC_ROLE_CLAIM];
  if (!Array.isArray(claims) || claims.length === 0) return null;
  if (!claims.every((role) => typeof role === 'string' && allowedRoles.has(role as Role)))
    return null;
  return claims as Role[];
}

const oidcProvider =
  env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET
    ? [
        {
          id: 'corporate',
          name: 'Corporate SSO',
          type: 'oidc' as const,
          issuer: env.OIDC_ISSUER,
          clientId: env.OIDC_CLIENT_ID,
          clientSecret: env.OIDC_CLIENT_SECRET,
          checks: ['pkce' as const, 'state' as const],
        },
      ]
    : [];

const credentialProvider =
  env.NODE_ENV !== 'production' && env.AUTH_CREDENTIALS_ENABLED
    ? [
        Credentials({
          name: 'Local development',
          credentials: { email: {}, password: {} },
          async authorize(credentials) {
            const email = typeof credentials?.email === 'string' ? credentials.email : '';
            const password = typeof credentials?.password === 'string' ? credentials.password : '';
            if (!email || !password) return null;
            const user = await db.user.findUnique({ where: { email } });
            if (!user?.isActive || !user.passwordHash) return null;
            if (!(await compare(password, user.passwordHash))) return null;
            return { id: user.id, name: user.name, email: user.email };
          },
        }),
      ]
    : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60, updateAge: 30 * 60 },
  cookies: {
    sessionToken: {
      name: env.SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: env.NODE_ENV === 'production',
      },
    },
  },
  pages: { signIn: '/login', error: '/login' },
  providers: [...oidcProvider, ...credentialProvider],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'credentials') return Boolean(user.id);
      if (!profile || !oidcRoles(profile as Record<string, unknown>)) return false;
      const email = typeof profile.email === 'string' ? profile.email : '';
      const subject = typeof profile.sub === 'string' ? profile.sub : '';
      if (!email || !subject) return false;
      const record = await db.user.findUnique({ where: { email } });
      if (!record?.isActive || record.oidcSubject !== subject) return false;
      user.id = record.id;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        const record = await db.user.findUnique({
          where: { id: user.id },
          select: { sessionEpoch: true, roles: true },
        });
        if (record) {
          token.sub = user.id;
          token.sessionEpoch = record.sessionEpoch;
          token.roles = record.roles;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.user.sessionEpoch = Number(token.sessionEpoch ?? -1);
        session.user.roles = (token.roles ?? []) as Role[];
      }
      return session;
    },
  },
});
