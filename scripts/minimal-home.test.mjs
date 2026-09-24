import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const home=readFileSync(new URL('../src/routes/index.tsx',import.meta.url),'utf8');
test('public homepage contains only the brand promise and client entry',()=>{
 assert.match(home,/Your business working better\./);
 assert.equal((home.match(/<a\s/g)||[]).length,1);
 assert.match(home,/https:\/\/app\.openfolk\.ai\/login\?redirect=%2Fclient/);
 assert.doesNotMatch(home,/Drummond|Heidi|£|mailto:|<form|<nav|<footer/);
});
test('glass button keeps accessible focus and reduced-motion support',()=>{
 const css=readFileSync(new URL('../src/styles/openfolk-home.css',import.meta.url),'utf8');
 assert.match(css,/focus-visible/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/backdrop-filter/);
});
