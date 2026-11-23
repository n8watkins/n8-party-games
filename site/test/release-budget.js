// What a reload into a new build may cost in requests to /api/, which the zone's rate rule counts
// per address. Shared by the crowd test (release-crowd.test.js, 30 phones behind one address,
// fake time) and the end-to-end test (lobby/test/e2e-release.mjs), which measures what a real
// page asks for as it reloads and fails if it is more than this.

/**
 * The /api/ requests a room page makes from the moment it reloads until it is back in its seat:
 * its socket, and room for one more (a big screen's config or QR code when its cache is cold).
 * /api/version is not among them: the new page is the room's build, so it never asks.
 */
export const API_REQUESTS_PER_RELOAD = 2;

/** The zone's rate rule on partygames.n8builds.dev ("Slow down floods"): this many /api/ requests per window per address. */
export const FLOOD_RULE = { requests: 100, windowMs: 10_000 };
