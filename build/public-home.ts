import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Plugin } from "vite";
import { OpenFolkHome } from "../src/components/OpenFolkHome";

/** Generate only the public index. Nitro/Vercel serves it ahead of the SSR fallback.
 * All private paths retain their existing app, auth and server handling.
 * The source component and stylesheet are shared, so the two versions cannot drift.
 */
export function publicHome(): Plugin {
  return {
    name: "openfolk-static-home",
    apply: "build",
    configResolved(config) {
      const css = readFileSync(resolve(config.root, "src/styles/openfolk-home.css"), "utf8");
      const markup = renderToStaticMarkup(createElement(OpenFolkHome));
      const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>OpenFolk: Your business working better.</title>
<meta name="description" content="OpenFolk: Your business working better.">
<meta property="og:title" content="OpenFolk: Your business working better.">
<meta property="og:description" content="OpenFolk: Your business working better.">
<link rel="canonical" href="https://www.openfolk.ai/">
<link rel="icon" type="image/svg+xml" href="/brand/openfolk-icon.svg">
<style>*,*::before,*::after{box-sizing:border-box}html{line-height:1.5;-webkit-text-size-adjust:100%;tab-size:4}body{margin:0}${css}</style>
</head><body>${markup}</body></html>`;
      writeFileSync(resolve(config.publicDir, "index.html"), html);
    },
  };
}
