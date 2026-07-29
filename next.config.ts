import type { NextConfig } from "next";

const discoveryOrigin = "https://discovery-app-avilaphms-projects.vercel.app";

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
  async rewrites() {
    return [
      {
        source: "/discovery",
        destination: discoveryOrigin,
      },
      {
        source: "/discovery/new",
        destination: `${discoveryOrigin}/new`,
      },
      {
        source: "/discovery/history",
        destination: `${discoveryOrigin}/discoveries`,
      },
      {
        source: "/discovery/settings",
        destination: `${discoveryOrigin}/settings`,
      },
      {
        source: "/discovery/:path+",
        destination: `${discoveryOrigin}/discovery/:path+`,
      },
      {
        source: "/discovery-static/:path+",
        destination: `${discoveryOrigin}/discovery-static/:path+`,
      },
      {
        source: "/api/clients",
        destination: `${discoveryOrigin}/api/clients`,
      },
      {
        source: "/api/discovery/:path+",
        destination: `${discoveryOrigin}/api/discovery/:path+`,
      },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/vendor/mediapipe/0.10.35/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
