# Configure federated sign-in

The provider buttons are enabled only when the Nitro runtime has the corresponding provider secret ARN and Cognito is configured for the provider. Scope each OAuth client to OB Auth. Current live status is in STATUS.md.

| Provider | Credential and setup | Exact redirect at the provider |
| --- | --- | --- |
| Google | OAuth web client ID and secret. Configure the consent audience and pilot users. | `https://ob-auth-414135856271.auth.us-east-1.amazoncognito.com/oauth2/idpresponse` and `https://auth.oscarbahamonde.com/api/auth/link-callback` |
| Microsoft Entra | Single-tenant Web application ID, secret value and directory tenant ID. Configure `https://login.microsoftonline.com/<tenant-id>/v2.0` as issuer and verify the pilot account emits the email claim. | `https://ob-auth-414135856271.auth.us-east-1.amazoncognito.com/oauth2/idpresponse` |
| GitHub | Dedicated OAuth App ID and secret for the GitHub connector on Dex. Deploy the broker with the supplied template, a dedicated HTTPS issuer and persistent storage. | `https://<dex-issuer-host>/callback` |

For Google, create a Web application under Google Auth Platform → Clients. For Microsoft, create a Web registration under Entra → App registrations, set the callback under Authentication and create a client secret under Certificates & secrets. Microsoft email is treated as unverified, and Microsoft account linking stays disabled. The integration uses the tenant-specific issuer.

Dex acts as the GitHub OAuth client and issues standard OIDC identities to Cognito. Give it only the GitHub connector, use GitHub's immutable numeric user ID, and use the broker's own separate Cognito-facing client ID and secret. Review Dex's email and verification assertions with the selected GitHub connector before rollout. Auth requests, signing keys and transactions require durable storage. See [Dex GitHub connector](https://dexidp.io/docs/connectors/github/) and [Dex authorization settings](https://dexidp.io/docs/configuration/oauth2/).

For each provider, save the ID and secret in a dedicated Secrets Manager JSON entry as `clientId` and `clientSecret`. Include `issuer` for Dex in the runtime secret. Pass its ARN to CDK as `OB_<PROVIDER>_SECRET_ARN`. Supply the Entra or Dex issuer using the corresponding `OB_*_ISSUER` variable. After confirming that Cognito has the expected IdP mapping, set the runtime `<PROVIDER>_SECRET_ARN` on the dedicated Vercel project and deploy. Keep access limited to pilot accounts until the browser flow is verified.

OB Auth sends Cognito the explicit `identity_provider` with a PKCE S256 challenge, validates the browser-bound state and nonce, and independently verifies the Cognito ID and access tokens before issuing a central cookie. The final callback is `https://auth.oscarbahamonde.com/api/auth/callback`. Cognito performs the upstream token validation when acting as the federation client. [Cognito OIDC IdP requirements](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-oidc-idp.html).
