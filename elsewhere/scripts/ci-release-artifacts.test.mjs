import test from 'node:test';
import assert from 'node:assert/strict';
import {selectArtifacts, services} from './ci-release-artifacts.mjs';
import {releaseJob} from './hk.mjs';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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
void test('activation follows the committed schema version and rejects stale or malformed releases', () => {
  const root=mkdtempSync(join(tmpdir(),'release-schema-'));
  const source=readFileSync(new URL('./aliyun-hk-code-release.sh',import.meta.url),'utf8');
  const checker=source.match(/node -e '([^']+)' "\$revision"/)?.[1];
  assert.ok(checker, 'release verifier missing');
  const actual=join(root,'actual.json'), expected=join(root,'expected.json');
  const code=checker.replace('"/evidence/public-release.json"',JSON.stringify(actual)).replace('"/expected-release.json"',JSON.stringify(expected));
  try {
    for(const version of [154,155,156]) {
      writeFileSync(expected,JSON.stringify({migration:version}));
      for(const [release,accepted] of [[{revision,migration:version},true],[{revision,migration:version-1},false],[{revision:'b'.repeat(40),migration:version},false]]) {
        writeFileSync(actual,JSON.stringify(release));
        assert.equal(spawnSync(process.execPath,['-e',code,revision]).status===0,accepted);
      }
    }
    writeFileSync(expected,JSON.stringify({migration:'155'}));
    writeFileSync(actual,JSON.stringify({revision,migration:'155'}));
    assert.notEqual(spawnSync(process.execPath,['-e',code,revision]).status,0);
  } finally {rmSync(root,{recursive:true,force:true});}
});
void test('Docker classic and containerd archives share a canonical config digest', () => {
  const root=mkdtempSync(join(tmpdir(),'image-config-'));
  const helper=fileURLToPath(new URL('./image-config-digest.sh',import.meta.url));
  const digest='c'.repeat(64);
  try {
    for (const config of [`${digest}.json`,`blobs/sha256/${digest}`]) {
      writeFileSync(join(root,'manifest.json'),JSON.stringify([{Config:config}]));
      const archive=spawnSync('tar',['-c','-f','-','-C',root,'manifest.json']);
      assert.equal(archive.status,0);
      const result=spawnSync('bash',[helper],{input:archive.stdout,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      assert.equal(result.stdout.trim(),`sha256:${digest}`);
    }
    for(const manifest of [[],[{Config:'../unsafe'}],[{Config:`${digest}.json`},{Config:`${digest}.json`}]]) {
      writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest));
      const archive=spawnSync('tar',['-c','-f','-','-C',root,'manifest.json']);
      const result=spawnSync('bash',[helper],{input:archive.stdout});
      assert.notEqual(result.status,0);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
