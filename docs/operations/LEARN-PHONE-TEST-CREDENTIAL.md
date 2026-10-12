# Existing Birchills credential in TEST — prepared, not applied

The existing `Birchills` item in the Employee vault of Allkin Group Ltd was read
through the authorised 1Password CLI session on 12 October 2026. Its username and
password were not displayed or written to a plaintext file. One authenticated
`GET https://pbx.sipcentric.com/api/v1/customers/me` returned HTTP 200 and account
3950, matching Drummonds' active production connector registry. This verifies
account identity; it does not prove call, recording or voicemail coverage.

Proposed destination: Supabase TEST project `saatxzwxvdvqevbnskxy`, server-side
Edge Function secrets `SIMWOOD_USERNAME` and `SIMWOOD_PASSWORD`. Both names are
currently absent. Read the existing item into process memory and write only these
two values; verify their digests and preserve all other secret metadata. Do not
overwrite an unexpectedly existing value or automatically repeat an uncertain write.

This reuses the existing portal credential; it does not create a provider identity,
key or permission. Its provider privileges remain those of the existing login,
not newly restricted read-only credentials. LEARN provider acceptance will use
bounded GET requests under the tenant/account gates. Secret provisioning alone
must not enable a phone account, capture flag, scheduled job or paid AI processing.

No production secret, data, source history or runtime is changed. The credential
stays out of Git, browser state, logs and public evidence. Provisioning is awaiting
Chris's decision about this additional hosted credential destination. Capture and
real audio acceptance require their separate prepared scope and current gates.

The provider's documented authentication contract is
[Simwood Direct API](https://developer.simwood.com/docs/direct/api/v1/).
