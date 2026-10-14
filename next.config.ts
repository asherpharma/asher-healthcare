import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  adapterPath: require.resolve("./scripts/gtm-head-adapter.mjs"),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
