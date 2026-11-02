import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // There's another package-lock.json higher up the folder tree; pin the
  // project root to this folder so Next.js doesn't guess.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
