export function assertAcceptanceTarget(endpoint) {
  const url = new URL(endpoint);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return;
  if (
    url.protocol !== 'https:' ||
    url.origin !== endpoint ||
    process.env.AGENTNET_ACCEPTANCE_ORIGIN !== endpoint
  )
    throw Error(
      'Public acceptance creates test Agents. Set AGENTNET_ACCEPTANCE_ORIGIN to the exact authorized HTTPS origin.',
    );
}

export async function acceptanceFetch(url, options) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      // A failed connection has sent no HTTP request. Never retry an ambiguous
      // response timeout: the server may already have committed a mutation.
      if (error.cause?.code !== 'UND_ERR_CONNECT_TIMEOUT' || attempt >= 2)
        throw error;
    }
  }
}
