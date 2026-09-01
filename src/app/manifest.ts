import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest and linked from the document head by Next.
// `start_url` deliberately points at the dashboard rather than "/": the root
// page only exists to bounce a signed-in visitor onward, so launching there
// from the home screen shows a redirect flash before the real content.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NTU Course Vault",
    short_name: "Course Vault",
    description:
      "Keep every NTU course's slides, notes and readings in one indexed place, backed by your own private GitHub repo.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f7f8",
    theme_color: "#c8102e",
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Android/Chrome crops this one to whatever shape the launcher uses, so
      // it is full-bleed with the glyph kept inside the 80% safe zone.
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
