# QuickBooks production app provisioning — prepared 14 October 2026

Status: approved and executed 14 October 2026 at 05:55 UTC. Intuit assessment
is Approved. Production callback saved, Vault app registration and secret equality
verified, Keychain and separate concealed 1Password recovery copy verified.
No company connection, import or financial source record exists at this checkpoint.

## Approved scope

- Use only OpenFolk ServiceOS, Intuit app `4ef4971d-2a39-4309-8c6c-46510d679c59`,
  owned in Drummond Heating Dashboard. Preserve the unrelated Drummonds Dashboard app.
- Add this production redirect URI, preserving existing entries:
  `https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1/quickbooks-oauth-callback`.
- Read the existing production client ID/secret, without rotating them. Register
  the app as `production` through the existing service-only provisioning RPC in
  production Supabase `tgbnakbxwcqjeimygroz`. The secret is encrypted in Vault
  under `quickbooks_app:4ef4971d-2a39-4309-8c6c-46510d679c59`.
- Store recovery copies in this Mac's Keychain under
  `serviceos.quickbooks.production.4ef4971d-2a39-4309-8c6c-46510d679c59`
  (account `production`), and a separate concealed field
  `serviceos_quickbooks_production` in the existing **Openfolk ServiceOS** 1Password
  note. Preserve every existing field and the separate development credential.
- Check metadata and credential equality in memory only. No plaintext, secrets,
  or credential fingerprints in output, Git, screenshots or evidence files.
  Any transfer file is mode 0600, excluded from Git and removed after verification.
- Registration persists until explicitly retired. It makes the app available to
  authorised production operators, but does not itself grant access to any
  accounting company. Intuit Accounting permission is broader than read-only;
  this connector restricts accounting operations to reads.

## Explicitly outside this step

No QuickBooks company consent, financial import, schedule, new user/grant,
accounting writes, payment action, AI processing or customer/job matching.
The real company consent is inspected separately before granting access.

## Verification and recovery

Require zero production app registrations/connections/imports before first setup;
stop on unexpected existing state. Verify exactly one app, revision 1, matching
production callback, encrypted credential equality and no company/import created.
An uncertain registration is inspected, never blindly repeated. Retire the new
registration if verification cannot be established. Revocation/deletion of the
provider credential is a separate owner action; preserve existing source history.
