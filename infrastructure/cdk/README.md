# OB Auth AWS operations

The `ob-auth-identity` CloudFormation stack in `us-east-1` owns one Cognito Essentials directory and one confidential portal client. It also owns the Cognito federation domain, DynamoDB state table, rotating KMS key, Secrets Manager portal credential, Vercel workload IAM role, SES sender identity, CloudWatch write-throttle alarm, and the optional project budget. Relying parties have independent credentials in the OB Auth registry.

## Apply infrastructure changes

Configure the workspace `.env` according to the root example, sign in with the AWS CLI, and verify `aws sts get-caller-identity` before deployment. CDK uses the AWS credential provider chain. The stack uses no bootstrap assets. For an existing Vercel IAM issuer, first verify its issuer and audience, then supply its ARN as `OB_VERCEL_ISSUER_ARN` when introducing the stack. Changing this field on an existing stack can remove an issuer managed by that stack. Keep `OB_BUDGET_EMAIL` configured on subsequent deployments to retain the budget.

```sh
pnpm --filter @ob-auth/infra synth
pnpm --filter @ob-auth/infra diff
pnpm --filter @ob-auth/infra deploy
```

The Vercel runtime assumes `RuntimeRoleArn` with the team issuer, team audience, and exact production project subject. Set production `AWS_ROLE_ARN`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_SECRET_ARN`, `COGNITO_DOMAIN`, `SESSION_TABLE`, and `SESSION_ENCRYPTION_KEY_ID` from stack outputs. Set `AUTH_DOMAIN` to the HTTPS portal origin. The client secret passes from Cognito to Secrets Manager through a CloudFormation resource attribute. Keep shared AWS credentials and provider secrets out of Vercel build arguments and frontend bundles.

The Cognito app-client configuration uses rotating 30-day refresh tokens, 15-minute access and ID tokens, and token revocation. The first OB Auth stack rolled back because Cognito Lite rejected refresh rotation. The existing pool, DynamoDB table, and KMS key were imported into `ob-auth-identity` before enabling Essentials and finishing configuration. Preserve those logical IDs and review each change set for replacements. [CloudFormation import](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/import-resources-manually.html) · [Cognito Essentials features](https://docs.aws.amazon.com/cognito/latest/developerguide/feature-plans-features-essentials.html)

## SES activation

Read the three `SesDkimName` and `SesDkimValue` output pairs and publish them as CNAMEs in the authoritative DNS zone. Check the identity and regional sending status using `sesv2 get-email-identity` and `sesv2 get-account`. Once DKIM is verified and SES grants production access in `us-east-1`, set `OB_SES_ENABLED=true` in `.env` and redeploy. A successful live sign-up and password-reset delivery should be checked after the switch. The pilot uses Cognito's built-in sender, subject to its regional email quota. [SES sandbox and production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) · [SES Easy DKIM](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy.html)

## Cost guard

Pilot AWS baseline is approximately **$1.50 to $1.60 per month** before usage and tax for one KMS key, one secret and one standard CloudWatch alarm, depending on the account's available free tier. Low-traffic DynamoDB requests, KMS operations, and eventual SES messages are metered. Each additional provider secret adds about $0.40 per month. Automatic KMS rotations can increase the monthly key charge. Cognito Essentials includes account- or organization-wide free allowances of 10,000 native/social MAUs and 50 external SAML/OIDC MAUs. Vercel plan or function overage and any GitHub broker hosting are billed separately. [KMS](https://aws.amazon.com/kms/pricing/) · [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) · [DynamoDB](https://aws.amazon.com/dynamodb/pricing/) · [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/) · [Cognito](https://aws.amazon.com/cognito/pricing/) · [SES](https://aws.amazon.com/ses/pricing/)

The `$15` AWS cost budget tracks the OB Auth allocation tag and emails at 60% and 100%. Activate the new `OBAuthPilot` key once it appears in Cost Explorer, then verify it is `Active`. The project budget only sees costs attributed to the active tag. DynamoDB caps the table at 25 read and 10 write request units per second, and CloudWatch records sustained write throttling. These controls reduce exposure and do not enforce a dollar ceiling. Sustained abusive traffic, multiple provider secrets, or usage beyond the shared Cognito free allowances can exceed the target. [Cost allocation tag activation](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html)

## Lost authenticator recovery

Use the owner-only `pnpm auth:totp:recover --username <cognito-username> --verified-subject <cognito-sub>` operation only after independently confirming the account owner through an established trusted contact channel and checking the Cognito subject. A request from the account's email alone is insufficient proof. The operator needs `AdminGetUser`, `AdminUserGlobalSignOut`, and `AdminDeleteSoftwareToken` for the OB Auth pool and DynamoDB `UpdateItem` for its account records. Portal workload credentials exclude authenticator deletion. The command removes the old authenticator and revokes directory tokens and central sessions. Afterward, the owner signs in with the password and enrolls a fresh authenticator. [Cognito TOTP recovery](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html)
