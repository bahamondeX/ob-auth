# OB Auth

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

Install the SDK with `pnpm add @oscarbahamonde/ob-auth`. The workspace and tarball options are documented in the [SDK setup guide](packages/auth/README.md). Configure its Nuxt module or the React adapter with a Node backend-for-frontend. Browser bundles use only same-origin session and navigation endpoints. Set the credentials in the host's private runtime configuration, and use the SDK on protected server routes in addition to frontend middleware.

## Authentication assurance

| Method | Central-session assurance |
| --- | --- |
| Email and password | Cognito-confirmed email, a valid password and Cognito-verified TOTP. The initial enrollment returns the setup secret only in the enrollment response. |
| Google | Cognito federation and the provider's verified-email claim when present. The session carries no OB Auth TOTP assertion. |
| Microsoft | A tenant-bound Entra identity. The mapped email is unverified and the session carries no OB Auth TOTP assertion. |
| GitHub | Cognito federation through the dedicated Dex issuer once deployed and verified. The session carries no OB Auth TOTP assertion. |

A relying party requiring TOTP will reject all federated sessions. Separate browser applications claim identity using Cognito `sub`, then apply their own access rules. The first-party ticket protocol uses a 60-second, application-bound, PKCE-bound, single-use code. The DynamoDB transaction checks revocation and expiration while consuming the code and issuing a grant. It provides the internal contract documented in the SDK.

Explicit linking starts from a native session and asks again for the password and TOTP. The browser then proves ownership of the selected provider identity through a separate OIDC authorization. Linking requires the same verified email as a secondary guard. An already-provisioned provider profile may need a reviewed merge or manual recovery using verified identifiers. The flow never performs an email-only merge.

## Operations

- [Deployment and verified status](STATUS.md)
- [Provider credentials and callbacks](docs/oauth-provider-setup.md)
- [Operations and security](docs/operations.md)
