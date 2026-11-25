# OB Auth application examples

The examples are two distinct confidential relying parties. Nuxt renders with SSR and protects both a page and an API. React uses a same-origin Node backend for its application session and protected API. Neither browser bundle requires access to the client secret.

| Application | App origin | Client ID | Callback URL | Logout URL |
|---|---|---|---|---|
| Nuxt | `http://localhost:3101` | `example-nuxt` | `http://localhost:3101/auth/callback` | `http://localhost:3101` |
| React | `http://localhost:3102` | `example-react` | `http://localhost:3102/auth/callback` | `http://localhost:3102` |

Copy each example's `.env.example` to its own `.env` with mode 600. Use the client secret issued during its OB Auth registration and an independent 32-byte key per app. Generate each key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and keep it in the relevant app's private environment. In examples talking to an HTTPS portal, the two loopback callback URLs must be registered on that portal first. Use HTTPS app origins for deployed applications. Browsers scope localhost cookies to the host regardless of port, so run both examples locally only when you trust both servers.

Run these commands in separate terminals, using the root README to start and configure the portal.

```sh
pnpm --filter @ob-auth/example-nuxt dev
pnpm --filter @ob-auth/example-react dev
```

Sign in at the Nuxt app, then choose sign-in at the React app in the same browser. A valid central session satisfying both app policies lets you finish the second sign-in without entering credentials again. Verify access to the protected API in React. Signing out of one app revokes that app's grant. Signing out everywhere goes to the OB Auth confirmation screen and revokes access through both grants once confirmed.

## Integrating a relying party

Install the SDK in your application with `pnpm add @oscarbahamonde/ob-auth`. The examples use the workspace copy, which you can package with `pnpm --filter @oscarbahamonde/ob-auth pack`. The package exports JavaScript and TypeScript declarations. The React example’s Node server uses TypeScript stripping for its example entry point.

### Nuxt 4

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

Set `NUXT_OB_AUTH_CLIENT_SECRET` and `NUXT_OB_AUTH_SESSION_KEY` in private runtime configuration. Use `definePageMeta({ middleware: 'ob-auth' })` to guard interactive SSR routes and `await requireObAuth(event)` in server handlers. Apply `Cache-Control: private, no-store` to authentication-dependent pages. Access `user`, `login`, `logout`, and `isAuthenticated` via the auto-imported `useAuth()` composable.

### React, Vue, and Node

Use `useAuth()` from `@oscarbahamonde/ob-auth/react` or `@oscarbahamonde/ob-auth/vue` within components and `createAuthClient()` from `@oscarbahamonde/ob-auth/core` in browser code outside components. The client provides `login()`, `logout()`, `getSession()`, `getUser()`, `requireAuth()`, and `isAuthenticated()`. Browser session checks support rendering and navigation. Apply data authorization independently on every protected server request.

Install a same-origin backend using `createServerAuth()` from `@oscarbahamonde/ob-auth/server`. The [React example backend](react/bff.ts) shows the four standard authentication routes and a protected API. The callback uses a state check and PKCE and exchanges the short-lived ticket directly with OB Auth. The local HttpOnly cookie contains an encrypted grant scoped to the application. Protected requests validate that grant against the central portal. The app receives the asserted Cognito subject and uses its own policy to decide which resources that subject can access. Protect app permissions independently of central identity and keep the client secret and cookie key server-side.

## Live SSO acceptance

With the portal and both examples running, create a private `.env.e2e` file at the workspace root with mode 600. Set `OB_AUTH_SSO_LIVE=1`, `OB_AUTH_E2E_EMAIL`, and `OB_AUTH_E2E_PASSWORD` for a dedicated, confirmed Cognito test account. For an account with an enrolled authenticator, add a current `OB_AUTH_E2E_TOTP_CODE`. Set `OB_AUTH_E2E_PORTAL_URL`, `OB_AUTH_NUXT_EXAMPLE_URL`, and `OB_AUTH_REACT_EXAMPLE_URL` to override the localhost origins.

```sh
node --env-file=.env.e2e node_modules/@playwright/test/cli.js test tests/sso.live.spec.ts
```

The test disables screenshots, videos, and traces while using live credentials.
