# OB Auth workspace

- Use the dedicated Cognito pool and CloudFormation stack listed in STATUS.md. Verify AWS identity and stack status before deploying.
- Keep provider credentials, Cognito tokens, TOTP material, application secrets, and test fixtures out of Git and command output.
- Run the workspace checks through pnpm. Live tests are opt-in and use dedicated test identities.
- A verified central identity does not replace resource authorization in relying applications.
