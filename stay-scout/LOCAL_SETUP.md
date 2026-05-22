# Stay Scout Local Setup

## Current local app

The project is unpacked in this folder and dependencies are installed with npm. The exported `.env` currently points at the hosted Supabase project, so the fastest local loop is:

```sh
npm run dev -- --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:8080/
```

The app loads listings from Supabase and uses Google OAuth through Supabase Auth.

## Hosted Supabase + local frontend

For Google sign-in to work from the local dev server, add these in the hosted Supabase dashboard:

```text
Authentication -> URL Configuration -> Redirect URLs
http://127.0.0.1:8080
http://localhost:8080
```

The app calls `signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })`, so the exact browser origin must be allow-listed.

In Google Cloud, the existing OAuth client should include:

```text
Authorized JavaScript origins:
http://127.0.0.1:8080
http://localhost:8080

Authorized redirect URIs:
https://rmonjbexchkyvkgecacn.supabase.co/auth/v1/callback
```

## Fully local Supabase

Local Supabase needs Docker Desktop plus the Supabase CLI:

```sh
supabase start
supabase status -o env
```

Use the values from `supabase status -o env` to create `.env.local`:

```sh
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key from supabase status>
VITE_SUPABASE_PROJECT_ID=local

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=<anon key from supabase status>
```

For local Google OAuth, add a web OAuth client in Google Cloud with:

```text
Authorized JavaScript origins:
http://127.0.0.1:8080
http://localhost:8080

Authorized redirect URIs:
http://127.0.0.1:54321/auth/v1/callback
```

Then configure `supabase/config.toml`:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
skip_nonce_check = false
```

And put the client values in `.env.local`:

```sh
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<google client id>
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=<google client secret>
```

Restart Supabase after changing auth config:

```sh
supabase stop
supabase start
```

## Notes from initial setup

- `npm install` completed successfully and created `package-lock.json`.
- `npm run build` completed successfully. Wrangler logged a non-fatal warning because the sandbox could not create `~/Library/Preferences/.wrangler`, but the build artifacts were produced.
- `supabase start` is currently blocked on Docker image download timeouts from `public.ecr.aws/supabase/postgres:17.4.1.043`. Retry `supabase start` once Docker or network access to that registry is stable.

References:

- Supabase local CLI: https://supabase.com/docs/guides/cli
- Supabase redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase Google login: https://supabase.com/docs/guides/auth/social-login/auth-google
- Google OAuth client settings: https://support.google.com/cloud/answer/15549257
