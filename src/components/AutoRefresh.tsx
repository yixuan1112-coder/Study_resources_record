"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-runs the server component that rendered the page, on a timer and whenever
 * the tab comes back to the front.
 *
 * For pages whose whole content is read straight from GitHub on the server,
 * this is all that "stay up to date" needs: `router.refresh()` re-renders with
 * fresh data and leaves client state alone. It is *not* enough for a page that
 * copies server data into `useState` — that state survives the refresh — which
 * is why the course workspace polls its own list instead.
 *
 * Renders nothing.
 */
export function AutoRefresh({ ms = 30_000 }: { ms?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      // A backgrounded tab should not keep spending GitHub rate limit.
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, router]);

  return null;
}
