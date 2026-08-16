# Location Ledger

A shared, mobile-friendly campaign location checklist backed by PostgreSQL.

## Local development

1. Create a PostgreSQL database.
2. Set `DATABASE_URL` and an `APP_PASSWORD` of at least 12 characters in the environment.
3. Run `npm install` and `npm run dev`.

The server creates its tables and seeds the 101-location catalogue at startup.

All campaign APIs require authentication. The password is never stored in the repository or browser storage; successful login creates a secure HTTP-only cookie. Changing `APP_PASSWORD` invalidates existing sessions.
