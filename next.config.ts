import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Allow this site's own origin to use mic/camera (voice briefs, dictation,
  // ML-assessment photo capture). An empty allowlist "()" blocks them for every
  // origin — including ours — so getUserMedia throws NotAllowedError even when
  // the browser's site permission is granted. "(self)" keeps cross-origin
  // iframes locked out while letting first-party features work.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
