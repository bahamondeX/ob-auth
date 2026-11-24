# OB Auth operations

## Dedicated AWS footprint

Deploy the CDK stack in us-east-1 using the authorized AWS account. The old `ob-auth` CloudFormation entry is a rolled-back deployment record. The retained Cognito pool, DynamoDB table and KMS key were imported into `ob-auth-identity`. Use change sets to inspect proposed replacements. The portal runtime assumes the role through the Vercel team OIDC issuer with a project- and production-scoped subject. Sync the Cognito app client secret to Secrets Manager using the current client ID before starting the portal.

Without a verified SES sender and production access in us-east-1, Cognito's default email service is suitable for low-volume pilot delivery only. The SES identity is staged for `auth.oscarbahamonde.com`. Add the six name/value outputs as three DKIM CNAME records. After DKIM succeeds, request SES production access and set `OB_SES_ENABLED=true` with the approved sending address. Keep the current setup operational while the request is reviewed.

## Session policy

The browser gets a host-only HttpOnly cookie with SameSite=Lax and Secure on HTTPS. It has a random opaque value and never contains Cognito tokens. DynamoDB enforces explicit idle and absolute expiry before TTL cleanup. Central idle defaults to one hour and absolute lifetime is capped at 24 hours by default. Cognito access and ID tokens expire after 15 minutes, and the refresh token lifetime is 30 days with rotation. Keep runtime limits within Cognito's configured lifetime.

Local app logout revokes that application's grant. Central sign-out changes the account generation, invalidating every central session and app grant, and requests Cognito global sign-out. Federated sign-out additionally clears the Cognito federation browser session. An upstream provider's independent browser session may still exist. Applications use SDK introspection when serving authenticated resources.

## Lost authenticator

For a native user who loses every copy of the enrolled authenticator, an operator independently verifies identity through a pre-established recovery channel and records the approval in the incident record. A password reset, access to the email inbox, or matching email alone does not authorize removing a factor. The operator runs `pnpm auth:totp:recover` using the dedicated pool and immutable subject identifier. The operator credential can remove a Cognito software token and revoke the account's Cognito tokens and OB Auth sessions. The portal runtime lacks MFA removal privileges. The next password sign-in requires fresh TOTP enrollment before issuing a session. Document the authorized changes without recording codes or credentials.

## Cost and monitoring

The USD 15 AWS pilot budget is an alert, and treatment of tagged costs depends on account-level activation. AWS KMS costs about USD 1/month for the customer-managed key before rotations, plus request charges. The portal's Secrets Manager secret is about USD 0.40/month plus API requests. DynamoDB on-demand reads/writes, Cognito tier/MAU, SES volume and CloudWatch alarms contribute variable charges. Vercel plan and usage are separate, and an external GitHub broker would introduce separate hosting costs. Recheck current regional pricing and allowance before increasing pilot traffic. [AWS Cognito pricing](https://aws.amazon.com/cognito/pricing/), [AWS KMS pricing](https://aws.amazon.com/kms/pricing/) and [AWS Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/).

Use Vercel and CloudWatch monitoring for authentication service errors, DynamoDB throttles and the monthly budget. Application error logs carry only a sanitized error class. Avoid request-body or URL-query collection on callbacks and exclude auth traffic from third-party analytics. Access to infrastructure logs is operationally privileged.

## Vercel release

The dedicated project is `ob-auth` in the `oscarbahamondedev-gmailcoms-projects` team. The production source deployment used Vercel's deployment API with repository root files and the `apps/auth` root directory, Nuxt framework detection, Node 22, `pnpm install --frozen-lockfile`, and `pnpm build`. Functions are pinned to IAD1. Project production variables contain resource identifiers and the Cognito secret ARN. The secret value stays in Secrets Manager.

For a subsequent release, use the same Vercel project with the CLI or deployment API after the workspace checks pass. Vercel deploys every source artifact independently of Git hosting. Check the rendered login page and `/api/health` after promotion. For the current DNS values and external blockers, see [STATUS.md](../STATUS.md).

### SES DKIM records for this stack

Publish these alongside the Vercel records in the NamesLink zone. Each record name is relative to `oscarbahamonde.com`.

| Type | Relative name | Value |
| --- | --- | --- |
| CNAME | `5c5gcesf7fhyyentjplgsdd3zxijvafs._domainkey.auth` | `5c5gcesf7fhyyentjplgsdd3zxijvafs.dkim.amazonses.com.` |
| CNAME | `z56fataie3lsfg73gy7tq7jknkoexj5d._domainkey.auth` | `z56fataie3lsfg73gy7tq7jknkoexj5d.dkim.amazonses.com.` |
| CNAME | `qx6ne227lehxoh5iaogbkpif2czzfakt._domainkey.auth` | `qx6ne227lehxoh5iaogbkpif2czzfakt.dkim.amazonses.com.` |

### Live fixture tests

The opt-in live tests use a separate native Cognito fixture and the enabled loopback example registrations. `tests/create-fixture.ts` generates a mode-600 fixture env file and seeds a confirmed `example.invalid` identity for tests that need MFA and a directly controlled subject. For the native suite set `OB_AUTH_NATIVE_LIVE=1`, load `.env` and `.env.fixture`, and run the Playwright native spec against localhost port 3000. The SSO test uses the two running examples and `OB_AUTH_SSO_LIVE=1` with a current authenticator code supplied from a private test environment. Disable test identities and remove the temporary credentials after the run. Registration and email-delivery evidence is recorded separately.
