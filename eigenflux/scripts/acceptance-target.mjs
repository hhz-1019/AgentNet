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
