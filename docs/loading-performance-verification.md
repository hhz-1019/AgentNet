# Loading and navigation verification — 2026-10-15

## Scope

This change addresses image delivery, repeat navigation, request reuse and loading transitions. It does not establish a production throughput limit or claim that every source of latency is eliminated. Production network/CDN latency must be measured again after release. No production deployment was performed by this side conversation.

## Observed baseline

- In the Codex in-app browser, Explore → Contacts → Explore removed previously visible posts and showed “正在加载动态…”.
- A public JPEG of 161,711 bytes returned `no-cache, no-store`. Three small-sample downloads took approximately 3.9s, 9.7s and 1.8s. Server-Timing reported about 2.5–3.6ms of application processing. These samples are not population percentiles and do not prove server capacity is sufficient.
- The first image request started through an intersection callback; off-screen originals were requested only 300px before visibility. Every successful image took 500ms to transition from blurred to clear.

## Implemented behavior

- Visible/nearby images start during layout; below-fold lead distance scales with viewport and connection, capped at 3000px. Save-data mode uses 300px. Visible images receive request priority.
- Internal post media offers 320/640/960/1440px variants through existing permission-checked endpoints. External image URLs, SVGs, GIFs and videos are not rewritten or transcoded by the resizing implementation. PNG transparency is retained. Images are never upscaled; larger encodings fall back to original bytes.
- Browser media caching uses private revalidation and content validators. Publication and ownership queries run before 304, including when the client presents a previously valid ETag. This reduces repeat transfer without granting long-lived public access to private attachments.
- Server derivative cache is capped at 128 entries/24MiB, with at most two concurrent decodes. Avatar URL cache is capped at 512 entries.
- Decode-ready images skip the blur transition; a new download uses a 180ms transition. Images and avatar lookups no longer block the entire brand entry curtain.
- Data reads retain up to 100 entries/8MB of estimated string storage for 60 seconds, scoped to the account's CSRF identity. Writes, explicit refresh and account changes invalidate cached reads. The merged API also independently coalesces in-flight reads.
- Navigation keeps four recent feed views for two minutes (up to 300 posts each), including filters, pagination and scroll position. Returning paints the previous view while refreshing. Background failures retain readable content; authorization failures clear it.
- Background feed refresh does not prepend rows above someone mid-scroll. Restored cards skip entrance animation; new-card stagger is capped at 200ms.
- Live activity events are coalesced. Reconciliation runs less frequently on healthy streams, sooner on disconnected streams, and pauses while hidden. Background activity does not force session refresh.
- Admin analytics, membership and registration screens load on demand. API cache headers are no longer mixed with Caddy's generic HTML cache policy.

## Verification

- `npm test`: 138 passing tests after integration.
- TypeScript check and lint of changed loading/navigation files: passed.
- Social/core suite against isolated PGlite: passed, including private-media access, revoked access with an ETag, 304 responses with zero body, image variants, guest projection and migration rollback.
- Vite production build: passed. Same integrated codebase before/after admin splitting: initial JS 503.38 → 474.56KB (gzip 161.98 → 154.65KB); initial CSS 330.13 → 315.50KB (gzip 54.36 → 51.99KB). These are bundle measurements, not measured user load-time improvements.
- Browser fixture `/preview/performance#explore`: 650ms deliberate list delay, 80 available posts. Returning from Contacts immediately retained 20 and later 40 cards without initial-feed loading UI. Simulated network failure retained existing cards. Actual pointer navigation retained scrollY=4327 across the round trip. Semantic automation clicks introduced a 7px focus-scroll adjustment; native pointer validation was used to distinguish that from restoration behavior.
- The fixture is DEV-only. It is not live production content, a load test, or a substitute for post-deployment image/network measurements.

## Release checks

1. Deploy web and core together so responsive URLs and validators are available together; apply the integrated database migrations through the existing release process.
2. Validate Caddy configuration in the deployment image; no Caddy executable was available in this local audit.
3. Measure first visit and repeat visit separately in Codex's browser and Chrome/Safari. Verify image byte savings, first visible images, page return, scroll position and private-image revocation.
4. Track real LCP/INP/CLS and request/application durations by route and device. Infrastructure resizing requires CPU, memory, connection-pool and query-wait evidence; no capacity recommendation is inferred from these local tests.

## References

- https://web.dev/articles/optimize-lcp
- https://web.dev/articles/browser-level-image-lazy-loading
- https://react.dev/reference/react/Suspense
- https://vercel.com/design/guidelines
