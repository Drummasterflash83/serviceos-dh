# Build 01 LIVE Edge v106 source: exact off-site copy review

**Prepared 16 October 2026; off-site copy pending.** A stable read-only LIVE
inventory completed at 22:05:09 UTC: 103 active functions, 728 source files and
4,828,503 source bytes. The function list was unchanged before and after
download. It includes `platform-worker` v106 with the 10-card sweep and Email
receipt continuation. A separate database function-scoped planner repair is
tracked in the Git migration; it is not part of an Edge source archive.

Every source file is pinned by a private manifest with SHA-256
`ed8ca3970251af3fe843dab9153f9c149a1f824513f245b2492e795a96026da6`.
The archive was locally checked and encrypted to the existing public ServiceOS
recovery recipient using the pinned age binary. The resulting ciphertext has
mode `0600` and was independently size/hash checked.

| Item | Exact prepared value |
| --- | --- |
| Local ciphertext | `.verification-results/build01-live-edge-source-2026-10-16-2203.age` |
| Bytes and SHA-256 | `6,022,776`; `06205d042fe8a4618ac6d291d654e03cf3ecaadad9d3ae65281069a778cd2ec5` |
| Destination | Existing private AWS London bucket `openfolk-serviceos-database-235099643372-eu-west-2` |
| Exact object key | `projects/tgbnakbxwcqjeimygroz/objects/b789aecbcce6989e7d6e210abeaa03270bcb3cf65533f227909354eaeae2a546/06205d042fe8a4618ac6d291d654e03cf3ecaadad9d3ae65281069a778cd2ec5` |
| Planned check | Create-only upload through the existing scoped Writer identity; download that stored object version through the separate Restore identity; compare bytes and SHA-256 |

The first key digest is SHA-256 of `serviceos-live-edge-source-package/1:`
followed by the private manifest digest. This is application source only; it
contains no runtime secret values, Auth signing material, frontend configuration
or customer data export. Copy/readback would not write production data or
source providers. It still would **not** establish full application/Auth
recovery without an isolated restored-service check.
