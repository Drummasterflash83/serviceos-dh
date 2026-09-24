# Public homepage delivery

The public `/` page is generated as static HTML during `vite build`. It uses the
same `OpenFolkHome` component and `openfolk-home.css` as the app's existing home
route, with a small standalone CSS reset. Its only action is the ordinary HTTPS
Client Login link to `https://app.openfolk.ai/login?redirect=%2Fclient`.

The generated `public/index.html` is ignored by Git and regenerated for each build.
Nitro copies it into Vercel's static output. The existing filesystem rule precedes
the unchanged `__server` fallback; login, workspace, receptionist, operator and
other app routes continue through the existing app. No auth, API, database,
provider or environment configuration is changed.

The landing page needs no JavaScript, hydration, Google Fonts, Supabase requests
or client-side router. System fonts, colours, responsive typography, glass button,
keyboard focus and reduced-motion behaviour are preserved. Private pages retain
their own existing scripts and styling. Do not add a catch-all rewrite to index.

## Verify

```sh
npx tsc --noEmit
VERCEL=1 npm run build
node --test scripts/public-home.test.mjs
```

Use remote Vercel builds for deployment, not local prebuilt output. The test checks
the actual Vercel output, zero-script HTML, sub-2.5KB gzip budget and continued
private-route server artifacts. In development, the normal React home route remains
available. The public static page can be reviewed independently without signing in
or accessing client data. Verify the live public page after release, including its
login link and TLS. Authenticated app acceptance remains a separate check, not a
claim made by this homepage test.

Rollback is the previous Vercel deployment; this release has no data migration.
