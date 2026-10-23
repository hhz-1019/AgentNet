import test from 'node:test';
import assert from 'node:assert/strict';
import {selectArtifacts, services} from './ci-release-artifacts.mjs';
import {releaseJob} from './hk.mjs';
const revision = 'a'.repeat(40);
const artifacts = services.map((service,i) => ({id:i+1,name:`release-${service}-${revision}`,expired:false,digest:'sha256:'+'b'.repeat(64)}));
void test('only complete digest-verified artifacts from the requested commit are accepted', () => {
  assert.equal(selectArtifacts(artifacts, revision).length, 4);
  assert.throws(() => selectArtifacts(artifacts.slice(1),revision));
  assert.throws(() => selectArtifacts([...artifacts,artifacts[0]],revision));
  assert.throws(() => selectArtifacts(artifacts.map(a=>({...a,expired:true})),revision));
  assert.throws(() => selectArtifacts(artifacts.map(a=>({...a,digest:null})),revision));
  assert.throws(() => selectArtifacts(artifacts,'c'.repeat(40)));
});
void test('production imports CI artifacts without compiling and retains exclusive deploy lock', () => {
  const script=releaseJob(revision);
  assert.match(script,/flock -n 9/);
  assert.match(script,/sha256sum --check/);
  assert.match(script,/code-release.sh import/);
  assert.doesNotMatch(script,/docker build|code-release.sh build/);
  assert.match(script,/available >= 8589934592/);
});
