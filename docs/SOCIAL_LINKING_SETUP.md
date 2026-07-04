# Social account linking setup

Social linking uses ArtSoul's Vercel API and the existing SIWE session. Provider secrets remain server-side. The old Supabase `discord-oauth` and `twitter-oauth` Edge Functions are not used by this flow.

## Production callback URLs

Add these exact URLs. Providers compare OAuth 2.0 callback URLs exactly.

Discord:

```text
https://artsoul.vercel.app/api/oauth/callback/discord
```

X:

```text
https://artsoul.vercel.app/api/oauth/callback/twitter
```

## Current pull-request preview callback URLs

Add these for real provider verification on the `fix/social-linking` preview. Confirm that the deployed Vercel alias matches before saving the provider settings.

Discord:

```text
https://artsoul-git-fix-social-linking-maysonkiller-be9112b5.vercel.app/api/oauth/callback/discord
```

X:

```text
https://artsoul-git-fix-social-linking-maysonkiller-be9112b5.vercel.app/api/oauth/callback/twitter
```

Vercel preview aliases are deployment-specific. Each preview host used for OAuth testing must be added as an exact callback URL in the provider portal.

## Local callback URLs

Use `vercel dev` so the API routes and cookies are available on the same origin.

Discord:

```text
http://localhost:3000/api/oauth/callback/discord
```

X:

```text
http://localhost:3000/api/oauth/callback/twitter
```

## Discord Developer Portal

1. Open the Discord application with client ID `1498799956536852480`.
2. Open **OAuth2**.
3. Under **Redirects**, add the exact Discord callback URLs above.
4. Save changes.
5. No bot or guild permissions are required. ArtSoul requests only the `identify` scope.

## X Developer Portal

1. Open the X project and app whose OAuth 2.0 Client ID is `YVNmTUVHcE5Sb1hVbnp3NUFFNUs6MTpjaQ`.
2. Open **User authentication settings** and enable OAuth 2.0.
3. Select **Web App, Automated App or Bot** so the server can use the confidential client secret.
4. Set app permissions to **Read**.
5. Add the exact X callback URLs above.
6. Set the Website URL to `https://artsoul.vercel.app`.
7. Save settings. ArtSoul requests `tweet.read users.read` and uses Authorization Code with PKCE.

If the IDs in the portals do not match the IDs above, use the portal's actual Client ID in Vercel and verify that the callback URLs were added to that same application.

## Vercel environment variables

Set these for Production and for any Preview environment used to test OAuth:

```text
DISCORD_CLIENT_ID=<Discord OAuth2 application client ID>
DISCORD_CLIENT_SECRET=<Discord OAuth2 application client secret>
X_CLIENT_ID=<X OAuth 2.0 client ID>
X_CLIENT_SECRET=<X OAuth 2.0 client secret>
OAUTH_ALLOWED_ORIGINS=https://artsoul.vercel.app,https://artsoul-git-fix-social-linking-maysonkiller-be9112b5.vercel.app
```

The existing server variables must also remain configured:

```text
SESSION_SECRET=<existing strong random server secret>
SUPABASE_URL=<existing Supabase project URL>
SUPABASE_SERVICE_ROLE_KEY=<existing Supabase service-role key>
```

Never put client secrets, `SESSION_SECRET`, or the Supabase service-role key in browser code or `NEXT_PUBLIC_*` variables.

No new Supabase dashboard variables or provider configuration are required. Profile persistence uses the existing server-side Supabase credentials.

## Verification

1. Connect the wallet that owns the profile.
2. Edit the profile and link Discord. Approve access and confirm the profile shows the Discord name.
3. Link X. Approve access and confirm the profile shows the X handle.
4. Reload the page and confirm both linked states persist.
5. Remove each linked account and confirm its name disappears after reload.
6. Repeat on mobile for the production origin.
