"use client";

import { useEffect } from "react";

/**
 * Registers the worker that makes the home-screen install open instantly and
 * show a real page instead of Safari's error when the network is gone.
 *
 * Registration is skipped in development on purpose. A worker that survives
 * across `next dev` restarts serves yesterday's chunks against today's HTML,
 * which looks exactly like a hydration bug and wastes an afternoon.
 *
 * Renders nothing.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Registering during load contends with the page's own requests for the
    // connection, which is the one moment the user is watching.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs the offline page and the warm cache.
        // The app itself works fine without it, so there is nothing to show.
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
