# OpenFolk wordmark — release contract

The approved header logo is lowercase **openfolk**, Helvetica/Arial bold:

- Light background: `open` navy `#203F70`, `folk` gold `#CC8625`.
- Emma's dark purple sidebar: `open` white, `folk` the same gold.
- Transparent background. No backing box, icon tile or blue/green dot.

All header wordmarks use `src/components/OpenFolkWordmark.tsx`: public homepage,
login, shared navigation, client programme and Emma. Parent layouts keep their
existing sizes; homepage and login use `size="inherit"`.

`npm run build` runs `scripts/brand-contract.test.mjs` first. It rejects the old
icon/dot markup in these headers, missing shared components, boxed wordmark code
and the wrong dark-sidebar variant. Do not replace or disable this guard when
merging older branches. Favicon artwork is separate and unchanged in this release.

The previous correction existed only on an unpromoted preview branch. This narrow
release starts from production main after the static-homepage optimisation and
does not bring pending playback/navigation/scorecard changes along with it.
Future releases must incorporate current main before promotion; a preview looking
correct is not evidence that production has that correction.
