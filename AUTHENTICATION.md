# SmoothPlays Authentication

## Configuration

Copy `.env.example` to `.env` and set `SECRET_KEY` to a new random value. For example, generate one with:

```sh
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Set `APP_ENV=production` and `SESSION_COOKIE_SECURE=true` behind HTTPS in production. Production startup intentionally fails if `SECRET_KEY` is missing. For multi-worker deployments, set `RATELIMIT_STORAGE_URI` to a shared Redis-compatible storage URL instead of the local in-memory default.

## Google OAuth

1. In the [Google Cloud Console](https://console.cloud.google.com/), create or select a project and configure the OAuth consent screen.
2. Create an OAuth client ID with application type **Web application**.
3. Add the exact value of `GOOGLE_REDIRECT_URI` to **Authorized redirect URIs**. For local development with Flask's default port, use `http://localhost:5000/auth/google/callback`. Use the public HTTPS callback URL for production.
4. Put the client ID and client secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Never put them in browser code or commit `.env`.

The app requests `openid email profile`. Authlib handles the OIDC authorization state, callback, and verified ID token. A verified Google account is matched by its stable `sub`. A Google identity is not attached to an existing password account based only on matching email; the user must continue with password login. No account-linking workflow is currently provided.

## Routes

- `POST /signup`: validate and create an email/password account.
- `POST /login`: verify an existing password account.
- `POST /logout`: clear the application session.
- `GET /api/me`: return only the current authenticated user's public profile fields.
- `GET /api/csrf`: return a non-cacheable CSRF token for same-origin form requests.
- `GET /auth/google` and `GET /auth/google/callback`: Google OpenID Connect sign-in.

CSRF tokens are required for state-changing requests. Passwords are stored as Werkzeug password hashes. Session cookies are HTTP-only and SameSite=Lax; Secure cookies are enabled automatically in production. Authentication endpoints have per-IP rate limits.

The initial implementation does not include password reset, email verification for password registrations, account linking, or persistent cross-worker rate limiting unless a shared limiter store is configured.

## Music library and downloads

SmoothPlays stores liked tracks, recently played tracks, playlists, and download metadata in the existing SQLite database. Library records are scoped to the signed-in account; visitors who are not signed in use a private guest library tied to their browser session. Guest library records are moved to the account when the visitor signs in or creates an account.

Jamendo tracks are downloadable only when Jamendo's `audiodownload_allowed` field permits it. The server retrieves the official `audiodownload` URL after checking this flag, streams the MP3 into persistent storage, and never accepts a download URL or filesystem path from the browser. Audius and local tracks remain playable but are not offered as downloads.

Downloaded audio is stored under `instance/downloads` by default, outside static assets. Set `DOWNLOADS_DIR` to a durable mounted directory for deployments where the application instance directory is not persistent. Downloaded audio is ignored by Git.