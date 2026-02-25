import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@infofi/shared` is a workspace package and may resolve to TS sources via `exports`.
  // Next does not reliably transpile TS from outside the app unless explicitly configured.
  transpilePackages: ["@infofi/shared"],
  experimental: {
    // Allow importing from pnpm workspace packages outside this app directory.
    externalDir: true,
  },
};

export default nextConfig;
