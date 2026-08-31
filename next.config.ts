import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/RET",
  assetPrefix: "/RET/",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
