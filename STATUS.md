# OB Auth status

Updated 2026-11-24. The AWS foundation and Vercel production build are running. G4 custom domain cutover passed. G5 provider and email acceptance remain open.

## G0–G2 · Foundation, native identity and SSO

- Discovered the dedicated Vercel project, verified AWS account 414135856271 and selected us-east-1. Reused the portfolio's live favicon byte-for-byte. The linked CodePen returned an access error.
- Recovered the pool, DynamoDB table and KMS key from the previous rolled-back infrastructure attempt. Imported them into the termination-protected `ob-auth-identity` CloudFormation stack. The deployed template matches the synthesized CDK template.
- Cognito pool `us-east-1_ZgLjGkDvK`, confidential Nitro client, Cognito federation domain `https://ob-auth-414135856271.auth.us-east-1.amazoncognito.com`, DynamoDB table `ob-auth-state` with TTL, and a dedicated rotating KMS key are live. Vercel uses the production-scoped AWS role. The confidential client credential resides in AWS Secrets Manager.
- Seeded five registrants. The localhost Nuxt and React examples are enabled. AEGIS, Connectivity, and Portfolio are staged disabled and their production authentication systems were left in place.
- A real canary registration succeeded and a Cognito verification email arrived at the owner-controlled canary mailbox. That user remains unconfirmed. Gmail withholds the one-time confirmation code. The supplied iOS/Android-compatible TOTP flow was tested separately using a dedicated, operator-seeded Cognito identity.

## G3 · Federation

| Provider | Delivery status | Required external configuration |
| --- | --- | --- |
| Google | Dedicated OB Auth Web client created in Google project `ob-auth-515722`. Credentials are in AWS Secrets Manager. Cognito redirected directly to `accounts.google.com` with HTTP 302. | Browser sign-in and account linking on the canonical hostname. |
| Microsoft | Dedicated single-tenant OB Auth Web application registered in CYM Ingenieros Entra with the authorized `.pe` account. The replacement credential is in AWS Secrets Manager. Cognito redirected directly to `login.microsoftonline.com` with HTTP 302. | Browser sign-in on the canonical hostname and verification that Entra supplies the required email claim. The new secret expires in May 2027. |
| GitHub | OAuth app `OB Auth` registered under `bahamondeX` and connected to the dedicated Auth0 Web application. Cognito has a live OIDC provider for it. Auth0 enables GitHub only and stores the GitHub credential. Its Cognito-facing credential is in AWS Secrets Manager. | Complete one browser sign-in on the canonical hostname. Dex remains a documented self-hosted option. |

CloudFormation change set `ob-auth-google-microsoft` applied without replacing the pool or app client. The first Entra secret was revoked after a diagnostics view exposed it. Its replacement was transferred directly into AWS Secrets Manager. The Cognito client has authorization-code flow, the exact OB Auth callback and three configured identity providers. Native password SDK authentication remains enabled. The exact callbacks and secret formats are in [provider setup](docs/oauth-provider-setup.md). Live sign-in and linking through these providers are pending. The `ob-auth-github-auth0-discovery` change set completed without replacing the Cognito pool or app client. Cognito rejected the initial authorization URL override containing a query and rolled back that attempt. With OIDC discovery, Cognito redirected to Auth0 with HTTP 302. Auth0 presented its GitHub-only sign-in page. A separate authorize request with the explicit GitHub connection redirected to GitHub with HTTP 302, `user:email`, and the exact broker callback. Federated sessions carry no native TOTP assertion. The Microsoft connection does not mark email verified. Application TOTP policies reject these sessions.

## G4 · Deployment

| Endpoint | Observed status |
| --- | --- |
| `https://ob-auth-rust.vercel.app` | Vercel production alias. Rendered the branded portal with HTTP 200. Health and session endpoints returned HTTP 200. |
| `https://auth.oscarbahamonde.com` | Published in NamesLink and verified by Vercel. The portal, health and session endpoints returned HTTP 200 over HTTPS. |
| `http://localhost:3000` | Live AWS-backed development portal. |
| `http://localhost:3101`, `http://localhost:3102` | Nuxt and React local SDK demonstration applications. |

Vercel production deployment `dpl_7YdhcR53DNjbGSx6zBaskRwAJrmM` rebuilt the verified portal release with GitHub, Google and Microsoft enabled. The session API advertised all three providers. The canonical-domain start routes returned HTTP 200 on the canonical hostname with PKCE S256, the exact HTTPS callback and secure host-only HttpOnly cookies. Cognito returned HTTP 302 to Google, Microsoft or the dedicated Auth0 broker. An Origin using the Vercel alias was rejected with HTTP 403. The check stopped before user authentication.

These two records are live in the NamesLink zone for `oscarbahamonde.com`. Both authoritative nameservers returned the CNAME and all four `_vercel` TXT values, including the three existing ones.

| Type | Relative name | Value |
| --- | --- | --- |
| CNAME | `auth` | `005d8a6f27de67d6.vercel-dns-017.com.` |
| TXT | `_vercel` | `vc-domain-verify=auth.oscarbahamonde.com,3b647e0b9181afc20b30` |

NamesLink required operator MFA for the first DNS write. Vercel returned `verified: true` for the custom hostname, and the HTTPS checks passed with normal certificate verification.

## G5 · Evidence and release gates

| Test | Result |
| --- | --- |
| TypeScript gates and production build | Passed for the workspace. Both SDK examples also type-checked and built. |
| Vitest | 10 passed. |
| Dependency scan | No known vulnerabilities reported in the production dependency audit. |
| Live AWS API and DynamoDB | Passed password sign-in, TOTP enrollment and next-window TOTP, incorrect-code rejection, encrypted token rotation, server-expired sessions, CSRF, exact callback and client validation, concurrent single-use ticket exchange, ticket replay rejection and rejection after central expiry or revocation. The linking route rejected a request without a central session. |
| Desktop live Chromium | SSO across the Nuxt and React applications using the same Cognito identity. Local app logout, reentry through central SSO and global logout with both app grants invalidated passed. |
| Mobile Chromium | Pixel 7 viewport and touch emulation passed real native Cognito sign-in, TOTP, layout and logout on a local production build. |
| Vercel browser smoke | Two UI tests passed with mocked auth responses over deployed HTTPS. The deployed SSR page returned HTTP 200 with CSP and HSTS. |
| Vercel live API | The deployed runtime passed origin rejection, real Cognito TOTP enrollment and sign-in, DynamoDB and KMS session creation, secure host-only cookie flags and global logout. The HTTP suite supplied the configured canonical Origin while calling the production alias. |
| Operator TOTP recovery | Passed on a dedicated Cognito fixture. Removing its authenticator revoked sessions and the next password sign-in required a new enrollment. |
| Lighthouse on local production build | Mobile 98 performance and 100 accessibility. Desktop 100 performance and 100 accessibility. Only the login route was scored. |
| Email and recovery acceptance | Real registration email delivered. Email code confirmation and password reset completion wait for test-user inbox verification. Production email uses Cognito's pilot sender until SES is ready. |
| Federation and account linking | All three providers are configured and their authorization redirects were exercised. Completed browser sign-in and linking on the canonical domain are pending. |
| Public deployment | DNS, Vercel ownership verification and the canonical HTTPS smoke test passed. End-to-end sign-in with provider accounts remains pending. |

The SDK is now named `@oscarbahamonde/ob-auth`. Version `0.1.0` passed a fresh tarball install and React and Vue SSR checks. The public npm registry serves the approved release as [@oscarbahamonde/ob-auth](https://www.npmjs.com/package/@oscarbahamonde/ob-auth). The Git repository has local milestone commits and no configured publication remote.

## Cost and remaining operations

- Dedicated AWS baseline is approximately USD 2.70–2.80/month before usage and tax for one KMS key, four Secrets Manager secrets and one alarm. Cognito, DynamoDB, SES and Vercel have separate usage costs and allowances. DynamoDB on-demand caps are 25 read and 10 write request units per second. They control capacity and do not impose a monthly spending cap.
- A USD 15 project budget and DynamoDB throttle alarm are deployed. The `OBAuthPilot=true` cost allocation tag still awaits Cost Explorer discovery/activation. The existing account budget provides interim account-level alerts.
- The dedicated SES identity's Easy DKIM records still need publication, and SES remains in the regional sandbox. The staged identity and CloudFormation outputs are ready. See [operations](docs/operations.md).
