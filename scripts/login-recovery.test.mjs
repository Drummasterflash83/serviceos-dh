import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { defaultParseSearch } from '@tanstack/react-router';

function fixture({ search = {}, searchString, session = null, loading = false, request, update } = {}) {
  const state = [], calls = [], navigations = [], effects = [];
  let cursor = 0, config;
  const auth = {
    session, loading, configured: true,
    requestPasswordReset: async (...args) => { calls.push(['request', ...args]); return request ? request() : { error: null }; },
    updatePassword: async () => { calls.push(['update']); return update ? update() : { error: null }; },
    signInWithPassword: async () => ({ error: null }),
    signUpWithPassword: async () => ({ error: null }),
    signOut: async () => { throw Error('Recovery must not require a second sign-in'); },
  };
  const route = { useSearch: () => config.validateSearch(searchString === undefined ? search : defaultParseSearch(searchString)) };
  const element = (type, props) => ({ type, props });
  const source = readFileSync(new URL('../src/routes/login.tsx', import.meta.url), 'utf8')
    .replace('import.meta.env.VITE_ENABLE_SIGNUP', '"false"');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(compiled, {
    exports: {}, window: { location: { origin: 'https://test.example.invalid' } },
    require(name) {
      if (name === 'react') return { useEffect(effect) { effects.push(effect); }, useState(initial) {
        const i = cursor++; if (!(i in state)) state[i] = initial;
        return [state[i], value => { state[i] = value; }];
      } };
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === '@tanstack/react-router') return {
        createFileRoute: () => options => { config = options; return route; },
        useNavigate: () => async target => { navigations.push(target); },
      };
      if (name === '@/lib/auth') return { useAuth: () => auth };
      if (name === '@/lib/auth-errors') return { friendlySignInError: () => 'Safe sign-in error' };
      if (name.endsWith('.css')) return {};
      return { Button: 'button', Input: 'input', Label: 'label', OpenFolkWordmark: 'wordmark' };
    },
  });
  let tree;
  function render() { cursor = 0; tree = config.component(); effects.splice(0).forEach(effect => effect()); return tree; }
  function all(node = tree) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(child => all(child ?? null))];
  }
  render();
  return {
    calls, navigations, auth, render,
    text: () => JSON.stringify(tree),
    click(label) { all().find(n => n.type === 'button' && n.props.children === label).props.onClick(); render(); },
    input(id, value) { all().find(n => n.props.id === id).props.onChange({ target: { value } }); render(); },
    async submit() { await all().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
    submitDisabled: () => all().find(n => n.props.type === 'submit').props.disabled,
  };
}

test('the exact emailed reset=1 URL stays on the password form after session recovery', async () => {
  assert.equal(defaultParseSearch('?reset=1').reset, 1);
  const f = fixture({ searchString: '?reset=1', loading: true });
  assert.match(f.text(), /Choose a new password/);
  f.auth.session = { user: { id: 'synthetic' } }; f.auth.loading = false; f.render();
  assert.match(f.text(), /Choose a new password/);
  assert.equal(f.navigations.length, 0);
  f.input('password', 'synthetic-only-long'); f.input('password-confirm', 'synthetic-only-long'); await f.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.navigations.length, 1);
  assert.equal(f.navigations[0].to, '/client');
});
test('boolean recovery links remain supported and ordinary sign-in still redirects', () => {
  for (const searchString of ['?reset=true', '?reset=1&redirect=%2Fopenfolk']) {
    const f = fixture({ searchString, session: {} });
    assert.match(f.text(), /Choose a new password/); assert.equal(f.navigations.length, 0);
  }
  for (const searchString of ['', '?reset=0', '?reset=false', '?reset=unexpected']) {
    const f = fixture({ searchString, session: {} });
    assert.doesNotMatch(f.text(), /Choose a new password/); assert.equal(f.navigations[0].to, '/client');
  }
});

test('failed reset request never claims delivery and can be retried', async () => {
  let fail = true;
  const f = fixture({ request: () => ({ error: fail ? 'PRIVATE provider detail' : null }) });
  f.click('Forgot your password?'); f.input('email', 'someone@example.invalid');
  await f.submit();
  assert.match(f.text(), /couldn’t confirm the reset request/);
  assert.doesNotMatch(f.text(), /PRIVATE|check your inbox/);
  assert.equal(f.submitDisabled(), false);
  fail = false; await f.submit();
  assert.match(f.text(), /If that address has access, check your inbox/);
  assert.equal(f.calls[0][2], 'https://test.example.invalid/login?reset=1');
});
test('thrown reset transport error restores the form without leaking details', async () => {
  const f = fixture({ request: () => { throw Error('PRIVATE network URL'); } });
  f.click('Forgot your password?'); f.input('email', 'someone@example.invalid'); await f.submit();
  assert.match(f.text(), /couldn’t confirm that request/);
  assert.doesNotMatch(f.text(), /PRIVATE|check your inbox/); assert.equal(f.submitDisabled(), false);
});
test('recovery waits for authentication and requires a live session', async () => {
  const f = fixture({ search: { reset: true }, loading: true });
  assert.equal(f.submitDisabled(), true); await f.submit(); assert.equal(f.calls.length, 0);
  f.auth.loading = false; f.render(); await f.submit();
  assert.match(f.text(), /invalid or has expired/); assert.equal(f.calls.length, 0);
});
test('short or mismatched passwords never reach the update API', async () => {
  const f = fixture({ search: { reset: true }, session: { user: { id: 'synthetic' } } });
  f.input('password', 'short'); f.input('password-confirm', 'short'); await f.submit();
  assert.match(f.text(), /at least 12/);
  f.input('password', 'synthetic-only-long'); await f.submit(); assert.match(f.text(), /do not match/);
  assert.equal(f.calls.length, 0);
});
test('failed password update stays on form without exposing provider errors', async () => {
  const f = fixture({ search: { reset: true }, session: {}, update: () => ({ error: 'PRIVATE provider detail' }) });
  f.input('password', 'synthetic-only-long'); f.input('password-confirm', 'synthetic-only-long'); await f.submit();
  assert.match(f.text(), /couldn’t update your password/); assert.doesNotMatch(f.text(), /PRIVATE|Password updated/);
  assert.equal(f.navigations.length, 0); assert.equal(f.submitDisabled(), false);
});
test('confirmed password update clears password fields and enters the chosen workspace', async () => {
  const f = fixture({ search: { reset: true, redirect: '/openfolk' }, session: {} });
  f.input('password', 'synthetic-only-long'); f.input('password-confirm', 'synthetic-only-long'); await f.submit();
  assert.match(f.text(), /Password updated/); assert.doesNotMatch(f.text(), /synthetic-only-long/);
  assert.equal(f.calls.length, 1); assert.equal(f.navigations[0].to, '/openfolk');
});
