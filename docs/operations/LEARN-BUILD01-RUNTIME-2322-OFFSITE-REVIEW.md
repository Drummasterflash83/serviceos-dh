# Build 01 LIVE Edge v107 source: exact off-site copy review

**Prepared 16 October 2026; off-site copy not yet authorised for this package.**
A stable read-only LIVE inventory completed at 23:24:59 UTC: 103 active
functions, 728 source files and 4,829,384 source bytes. It includes
`platform-worker` v107. The function inventory was unchanged before and after
download. Compared with the locally verified v106 inventory, only
`platform-worker` changed; the other 102 function trees are byte-for-byte
unchanged.

Every source file is pinned by a private manifest with SHA-256
`4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488`.
The archive was checked, encrypted to the existing public ServiceOS recovery
recipient using the pinned age binary, and reconstructed into 103 separate
local function trees with every file hash checked again. The ciphertext has
mode `0600` and was independently checked for size and SHA-256.

| Item | Exact prepared value |
| --- | --- |
| Local ciphertext | `.verification-results/build01-live-edge-source-2026-10-16-2322.age` |
| Bytes and SHA-256 | `6,022,776`; `dcfcbb300d0239f379f744e55e989fb1a4bcd2b85ab67f1c8b3fa5a940f55473` |
| Destination | Existing private AWS London bucket `openfolk-serviceos-database-235099643372-eu-west-2` |
| Exact object key | `projects/tgbnakbxwcqjeimygroz/objects/a4d892a1387b1c19c53caea3cdfb85d7c15dd80929cd2c5defeef7b5621d1656/dcfcbb300d0239f379f744e55e989fb1a4bcd2b85ab67f1c8b3fa5a940f55473` |
| Planned check | Create-only upload through the existing scoped Writer identity; download that stored version through the separate Restore identity; compare bytes and SHA-256 |

The first key digest is SHA-256 of `serviceos-live-edge-source-package/1:`
followed by the private manifest digest. This is application source only: the
package contains no exported runtime secret values, Auth signing material,
frontend configuration or customer-data export. The copy/readback would not
write production data or source providers. It would still not establish full
application/Auth recovery without the isolated recovered-service check.
