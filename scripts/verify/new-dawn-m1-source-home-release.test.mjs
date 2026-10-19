import assert from 'node:assert/strict';
import test from 'node:test';
import { migrationBodies, releaseSql } from './new-dawn-m1-source-home-release.mjs';

test('exact pinned M1 migrations package an operator gate without publishing either flag', () => {
  const bodies = migrationBodies();
  assert.equal(bodies.length, 2);
  assert.match(bodies[0], /create function public\.new_dawn_source_job_home/);
  assert.match(bodies[1], /new_dawn\.source_job_home\.operator_preview/);
  assert.doesNotMatch(bodies.join('\n'), /insert into public\.feature_flags/i);
  const live = releaseSql('live-install');
  assert.match(live, /m1_source_home_already_installed/);
  assert.match(live, /m1_source_home_flag_already_enabled/);
  assert.match(live, /new-dawn-m1-source-home-installed\/1/);
  assert.match(live, /commit;\s*$/);
  assert.doesNotMatch(live, /update public\.feature_flags set value='true'/i);
  assert.doesNotMatch(live, /Rollback-only OpenFolk M1 preview/);
});

test('TEST rehearsal proves the operator route then rolls back its flag and audit', () => {
  const rehearsal = releaseSql('test-rollback');
  assert.match(rehearsal, /Rollback-only OpenFolk M1 preview/);
  assert.match(rehearsal, /client_flag_off_admitted/);
  assert.match(rehearsal, /foreign_actor_admitted/);
  assert.match(rehearsal, /rollback;\s*$/);
  assert.throws(() => releaseSql('unknown'));
});
