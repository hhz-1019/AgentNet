import assert from 'node:assert/strict';

export const services = ['core', 'web', 'gorse', 'sync'];

export function selectArtifacts(artifacts, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  return services.map(service => {
    const found = artifacts.filter(a => a.name === `release-${service}-${revision}` && !a.expired);
    assert.equal(found.length, 1, `Missing or ambiguous CI image: ${service}`);
    const artifact = found[0];
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(artifact.id) && artifact.id > 0);
    return {service, id: artifact.id, digest: artifact.digest.slice(7)};
  });
}

// Temporary GitHub URLs only; no GitHub credential is copied to the server.
export async function signedArtifacts({artifacts, revision, repository, token}) {
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  return Promise.all(selectArtifacts(artifacts, revision).map(async artifact => {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`, {
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json'},
      redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 302, `Unable to resolve CI image ${artifact.service}`);
    const url = new URL(response.headers.get('location'));
    assert.equal(url.protocol, 'https:');
    assert(url.hostname.endsWith('.blob.core.windows.net') || url.hostname.endsWith('.githubusercontent.com'), 'Unexpected artifact storage');
    return {...artifact, url: url.href};
  }));
}
