# OB Auth

![A glowing sapphire identity core encircled by titanium rings](./docs/assets/ob-auth-portrait.webp)

OB Auth is a Nuxt 4 authentication portal for Oscar Bahamonde's applications. One Cognito User Pool owns credentials and identity. Nitro runs the portal and first-party SSO protocol. DynamoDB holds centralized sessions and short-lived transactions. AWS KMS protects Cognito tokens and pending native authentication material. The application backend keeps its own host-only session and checks central grants on protected requests.

The Cognito App Client belongs to the OB Auth server. Each relying application has a different OB Auth client ID and backchannel credential. Authorization, including app membership and protected resources, remains the application's responsibility.

## Run locally

Use Node.js 22.21+ in the 22 series or 24.11+ in the 24 series and pnpm 10. Copy .env.example to .env, restrict it to mode 600 and populate identifiers from the dedicated CDK outputs. Local AWS authentication uses the usual SDK provider chain. Vercel production reads confidential credentials from AWS Secrets Manager through workload identity.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm e2e
pnpm build
pnpm cdk:synth
```

The portal is at http://localhost:3000. For a complete SSO run, configure [the Nuxt and React examples](examples/README.md) on ports 3101 and 3102 and register their exact callbacks.

## Add an application

```sh
pnpm auth:app:create --name "My Application" --callback "https://myapp.oscarbahamonde.com/auth/callback"
```

The CLI registers a confidential application with a random server credential. Store the generated mode-600 environment file securely. Review the application's access policy, registered redirects, and SDK configuration before enabling it. The example registrations for AEGIS, Connectivity, and the portfolio are staged for later integration. Their authentication systems are untouched.

## SDK examples

Install the SDK in your app. The React and Vue adapters use the same authentication routes on your app's origin.

```sh
pnpm add @oscarbahamonde/ob-auth
```

### React 19

```tsx
import { useState } from 'react'
import { useAuth } from '@oscarbahamonde/ob-auth/react'

export function Account() {
  const { user, pending, error, login, logout } = useAuth()
  const [signOutFailed, setSignOutFailed] = useState(false)

  if (pending) return <p>Checking your session…</p>
  if (error) return <p role="alert">Could not check your session.</p>
  if (!user) return <button onClick={() => login()}>Sign in with OB Auth</button>

  return (
    <section>
      <p>Signed in as {user.email}</p>
      <button onClick={() => {
        setSignOutFailed(false)
        void logout().catch(() => setSignOutFailed(true))
      }}>Sign out</button>
      {signOutFailed && <p role="alert">Could not sign out.</p>}
    </section>
  )
}
```

### Vue 3.5

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '@oscarbahamonde/ob-auth/vue'

const { user, pending, error, login, logout } = useAuth()
const signOutFailed = ref(false)

async function signOut() {
  signOutFailed.value = false
  try {
    await logout()
  } catch {
    signOutFailed.value = true
  }
}
</script>

<template>
  <p v-if="pending">Checking your session…</p>
  <p v-else-if="error" role="alert">Could not check your session.</p>
  <section v-else-if="user">
    <p>Signed in as {{ user.email }}</p>
    <button @click="signOut">Sign out</button>
    <p v-if="signOutFailed" role="alert">Could not sign out.</p>
  </section>
  <button v-else @click="login()">Sign in with OB Auth</button>
</template>
```

### Node backend with H3

Install `h3@1` alongside the SDK. Set `OB_AUTH_APP_ORIGIN` to the browser-facing origin you registered. Load `OB_AUTH_CLIENT_ID`, `OB_AUTH_CLIENT_SECRET`, and `OB_AUTH_SESSION_KEY` from the CLI-generated credentials file into the backend's private environment. Save the example as `server.mjs` and run `node --env-file=.env server.mjs` for local development. Route `/auth/*` and `/api/whoami` to this server through your app's origin.

```js
import { createServer } from 'node:http'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { createServerAuth } from '@oscarbahamonde/ob-auth/server'

const auth = createServerAuth({
  domain: 'https://auth.oscarbahamonde.com',
  appOrigin: process.env.OB_AUTH_APP_ORIGIN,
  clientId: process.env.OB_AUTH_CLIENT_ID,
  clientSecret: process.env.OB_AUTH_CLIENT_SECRET,
  sessionKey: process.env.OB_AUTH_SESSION_KEY,
})

const router = createRouter()
router.get('/auth/login', defineEventHandler(auth.login))
router.get('/auth/callback', defineEventHandler(auth.callback))
router.get('/auth/session', defineEventHandler(async (event) => ({
  session: await auth.getSession(event),
})))
router.post('/auth/logout', defineEventHandler(auth.logout))
router.get('/api/whoami', defineEventHandler(async (event) => {
  const { user } = await auth.requireAuth(event)
  return { sub: user.sub }
}))

createServer(toNodeListener(createApp().use(router)))
  .listen(Number(process.env.PORT || 3102), 'localhost')
```

Use the verified `sub` to look up the user's permissions before serving application data. See the [runnable React and Nuxt examples](examples/README.md) and the [SDK setup guide](packages/auth/README.md) for local setup and server-side rendering.

## Authentication assurance

| Method | Central-session assurance |
| --- | --- |
| Email and password | Cognito-confirmed email, a valid password and Cognito-verified TOTP. The initial enrollment returns the setup secret only in the enrollment response. |
| Google | Cognito federation and the provider's verified-email claim when present. The session carries no OB Auth TOTP assertion. |
| Microsoft | A tenant-bound Entra identity. The mapped email is unverified and the session carries no OB Auth TOTP assertion. |
| GitHub | Cognito federation through the dedicated GitHub-only Auth0 broker. The session carries no OB Auth TOTP assertion. |

A relying party requiring TOTP will reject all federated sessions. Separate browser applications claim identity using Cognito `sub`, then apply their own access rules. The first-party ticket protocol uses a 60-second, application-bound, PKCE-bound, single-use code. The DynamoDB transaction checks revocation and expiration while consuming the code and issuing a grant. It provides the internal contract documented in the SDK.

Explicit linking starts from a native session and asks again for the password and TOTP. The browser then proves ownership of the selected provider identity through a separate OIDC authorization. Linking requires the same verified email as a secondary guard. An already-provisioned provider profile may need a reviewed merge or manual recovery using verified identifiers. The flow never performs an email-only merge.

## Operations

- [Deployment and verified status](STATUS.md)
- [Provider credentials and callbacks](docs/oauth-provider-setup.md)
- [Operations and security](docs/operations.md)
