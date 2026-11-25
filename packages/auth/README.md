# @oscarbahamonde/ob-auth

The TypeScript SDK for first-party OB Auth relying parties. Register your app with a backend callback at `https://<app-origin>/auth/callback`. Keep the issued client secret and an independent 32-byte base64url session key in the app's private runtime configuration.

## Nuxt 4

```typescript
export default defineNuxtConfig({
  modules: ['@oscarbahamonde/ob-auth'],
  obAuth: {
    domain: 'https://auth.oscarbahamonde.com',
    clientId: process.env.OB_AUTH_CLIENT_ID,
    appOrigin: 'https://myapp.oscarbahamonde.com',
  },
})
```

Set `NUXT_OB_AUTH_CLIENT_SECRET` and `NUXT_OB_AUTH_SESSION_KEY` at runtime. Set `NUXT_OB_AUTH_LOGOUT_URI` if your registered logout URL differs from the app origin. The module supplies the `useAuth()` composable, `ob-auth` page middleware, and `requireObAuth(event)` for protecting server routes. Keep authenticated pages dynamic and private.

## React, Vue, and Node

Import `useAuth()` from `@oscarbahamonde/ob-auth/react` or `@oscarbahamonde/ob-auth/vue`. Outside components, `createAuthClient()` from `@oscarbahamonde/ob-auth/core` provides the same browser operations. React and Vue SSR can initialize the hook with an app session read using `createServerAuth().getSession(event)`.

Use `createServerAuth()` from `@oscarbahamonde/ob-auth/server` in an H3 backend hosted on the app's origin. Wire these backend routes.

| Route | Handler |
| --- | --- |
| `GET /auth/login` | `auth.login(event)` |
| `GET /auth/callback` | `auth.callback(event)` |
| `GET /auth/session` | `{ session: await auth.getSession(event) }` |
| `POST /auth/logout` | `auth.logout(event)` |

Call `auth.requireAuth(event)` before serving protected data and enforce your app's access policy using the returned immutable Cognito `sub`. The browser receives only the app session's public fields. The backend exchanges the one-time ticket and validates the app session grant through OB Auth.

The OB Auth repository includes an application integration guide and runnable Nuxt and React examples under `examples/`.
