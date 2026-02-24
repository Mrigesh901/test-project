const { i18n } = require('./next-i18next.config');

/**
 * Next.js Configuration
 *
 * output: 'standalone'
 * ─────────────────────────────────────────────────────────────────────────────
 * Tells Next.js to produce a self-contained output in .next/standalone/.
 * This directory contains:
 *   - server.js        → the actual HTTP server (run with `node server.js`)
 *   - node_modules/    → minimal subset of dependencies needed at runtime
 *   - .next/           → compiled pages and chunks
 *
 * WHY THIS MATTERS FOR DOCKER:
 * Without standalone, running Next.js in production requires copying the
 * entire node_modules (500MB+) into the container.
 * With standalone, only the ~20MB of actually-used modules are included.
 * Final image: ~180MB vs ~700MB. Same functionality.
 *
 * Safe for local dev: `next dev` ignores the output setting entirely.
 *
 * eslint.ignoreDuringBuilds: true
 * ─────────────────────────────────────────────────────────────────────────────
 * ESLint runs as its own CI stage (faster feedback, separate concerns).
 * `next build` only needs to produce a working binary, not enforce style.
 */
module.exports = {
    output: 'standalone',
    eslint: {
        ignoreDuringBuilds: true,
    },
    i18n,
}
