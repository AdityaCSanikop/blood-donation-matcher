import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen shows live, per-user, auth-gated data fetched from the API,
  // so the scaffold's prerender/caching features (cacheComponents,
  // partialPrefetching) are intentionally not enabled.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
