# Supabase database setup

This guide connects the project to Supabase as a hosted **PostgreSQL** database. Supabase is not the app's authentication provider or a replacement for Redis. The project reference for the current demo is `ikyxoidltualpzklrhmn`.

## Protect the app tables first

The Prisma migrations create tables in PostgreSQL's `public` schema. Supabase exposes this schema through its Data API by default. The app uses Prisma exclusively, so turn off the **Data API** in the project's [API settings](https://supabase.com/dashboard/project/ikyxoidltualpzklrhmn/settings/api) **before applying migrations**. Do not migrate into a project whose Data API must remain enabled for another application. Use a dedicated Supabase project in that case.

Supabase's [Prisma guide](https://supabase.com/docs/guides/database/prisma) recommends disabling the Data API when using Prisma alone; its [API security guide](https://supabase.com/docs/guides/api/securing-your-api) documents the default `public` schema privileges.

## Connection

1. Rotate the database password in [Database Settings](https://supabase.com/dashboard/project/ikyxoidltualpzklrhmn/database/settings) if it has been shared in chat or a screenshot. You may choose your own strong new password. Use only that password in the local connection URI.
2. Open the project's [Session pooler connection panel](https://supabase.com/dashboard/project/ikyxoidltualpzklrhmn?showConnect=true&method=session) and confirm it uses `aws-0-eu-west-1.pooler.supabase.com:5432` for this project.
3. From the project root in a local PowerShell terminal, run the helper below. Enter the **new** database password at its hidden prompt. It URL-encodes special characters and replaces both database URLs in the ignored `.env` without printing the credential:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\set-supabase-password.ps1
   ```

   Do not put the connection URI in source control, screenshots, logs, or chat.
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
