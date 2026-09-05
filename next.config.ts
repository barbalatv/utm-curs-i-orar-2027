import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdfjs-dist", "cheerio"],
  outputFileTracingIncludes: {
    "/api/**": ["./data/seed/**"],
  },
};

export default nextConfig;
