import type { NextConfig } from "next";

// Supabase uses self-signed cert chain — bypass TLS verification for DB connections
if (process.env.DATABASE_URL?.includes("supabase")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const nextConfig: NextConfig = {
  reactCompiler: true,
};

export default nextConfig;
