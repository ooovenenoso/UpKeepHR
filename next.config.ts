import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {"/*":["./public/brand/upkeephr-logo.png","./certs/supabase-ca.crt"]},
  async headers(){return [{source:"/(.*)",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"Referrer-Policy",value:"same-origin"},{key:"X-Frame-Options",value:"DENY"},{key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"}]}];},
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
};
export default config;
