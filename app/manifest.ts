import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Workspace",
    short_name: "Workspace",
    description:
      "A place for your plans: tasks, notes, learning, and agent updates.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#fcfbff",
    theme_color: "#6542e8",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
