# Supabase database setup

This guide connects the project to Supabase as a hosted **PostgreSQL** database. Supabase is not the app's authentication provider or a replacement for Redis. The project reference for the current demo is `ikyxoidltualpzklrhmn`.

## Protect the app tables first

The Prisma migrations create tables in PostgreSQL's `public` schema. Supabase exposes this schema through its Data API by default. The app uses Prisma exclusively, so turn off the **Data API** in the project's [API settings](https://supabase.com/dashboard/project/ikyxoidltualpzklrhmn/settings/api) **before applying migrations**. Do not migrate into a project whose Data API must remain enabled for another application. Use a dedicated Supabase project in that case.

Supabase's [Prisma guide](https://supabase.com/docs/guides/database/prisma) recommends disabling the Data API when using Prisma alone; its [API security guide](https://supabase.com/docs/guides/api/securing-your-api) documents the default `public` schema privileges.

## Connection

1. Rotate the database password in Supabase if it has been shared in chat or a screenshot. Use only the new password in the local connection URI.
2. Open the project's [Session pooler connection panel](https://supabase.com/dashboard/project/ikyxoidltualpzklrhmn?showConnect=true&method=session). In **Connect → Connection string**, select **Session pooler** (port `5432`) and copy its URI for the `postgres` database. Fill in the database password locally. URL-encode any reserved characters in the password.
3. In the ignored local `.env`, set `DATABASE_URL` and `DIRECT_DATABASE_URL` to that session-pooler URI. Do not put either URI in source control, screenshots, logs, or chat.
4. Keep `NODE_ENV=development` for the local preview. Supabase database hosting does not satisfy the separate production requirements for OIDC, shared rate limiting, workers, external audit anchors, backups, and drills.

The session pooler is the IPv4-compatible option recommended by Supabase for Prisma. A direct database URI can be used for `DIRECT_DATABASE_URL` only when the deployment host has IPv6 connectivity or the project has the IPv4 add-on. Do not use the transaction pooler (port `6543`) for migrations.

## First migration

Run these commands from the project root after saving `.env`:

```powershell
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
```

The first status command confirms which migrations are pending. `migrate deploy` applies the existing migrations without resetting data. Do not run `prisma migrate reset`, `seed:reset`, `demo:reset`, or integration tests against this hosted project unless you intentionally want their data changes.

The free Supabase plan pauses after inactivity and does not include automatic backups. Use it for a synthetic-data demo, not as evidence of production readiness. Keep a separate local Docker database for development and destructive tests.
