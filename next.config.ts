import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // A service worker that is itself cached is a worker you cannot
        // replace: installed phones would keep running the old caching rules
        // long after a deploy. The offline page is fetched by that worker at
        // install time, so it has the same problem.
        source: "/:file(sw.js|offline.html)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
