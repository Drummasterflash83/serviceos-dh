# Governed file import UI review

This isolated preview renders the actual `LearnFileImports` component and client
against a synthetic in-memory function adapter. It has no credentials or backend
connection; CSP denies network connections. It does not prove hosted behavior.

Build with `node node_modules/vite/bin/vite.js build --config preview/learn-imports/vite.config.mjs`.
Serve with the same command replacing `build` with `preview`; loopback port 47873.
The normal page has a saved preview. `?scenario=uncertain` simulates a lost response
after a committed apply. `?scenario=unavailable` denies reads. `?role=ops` removes
write controls. Use `SYNTHETIC.csv` only; reload resets fixture state.

`?scenario=pages` exposes 250 completed synthetic outcomes across three pages.
`?scenario=page-failure` fails reads beyond the first page so reload recovery can be checked.
The embedded wrapper omits the full application sidebar background.
