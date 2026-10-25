import type { Metadata, MetadataRoute } from "next";
export const description =
  "Tasks, notes, learning, and agent updates in one personal workspace. Make room for your plans.";
export const siteTitle = "Workspace - A place for your plans.";
export function publicOrigin(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (!env.WORKSPACE_PUBLIC_ORIGIN) return undefined;
  const url = new URL(env.WORKSPACE_PUBLIC_ORIGIN);
  if (
    url.protocol !== "https:" ||
    url.origin !== env.WORKSPACE_PUBLIC_ORIGIN ||
    url.username ||
    url.password
  )
    throw new Error("Invalid verified public origin");
  return url.origin;
}
export function brandMetadata(
  env: Record<string, string | undefined> = process.env,
): Metadata {
  const verified = publicOrigin(env);
  let base = verified ? new URL(verified) : undefined;
  if (!base && env.WORKSPACE_ORIGIN) {
    const url = new URL(env.WORKSPACE_ORIGIN);
    if (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.origin === env.WORKSPACE_ORIGIN
    )
      base = url;
  }
  return {
    ...(base ? { metadataBase: base } : {}),
    applicationName: "Workspace",
    title: { default: siteTitle, template: "%s | Workspace" },
    description,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "Workspace",
      statusBarStyle: "default",
    },
    openGraph: {
      type: "website",
      siteName: "Workspace",
      title: siteTitle,
      description,
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: siteTitle,
      description,
      images: [
        {
          url: "/opengraph-image.png",
          alt: "Workspace: A place for your plans. A mint robot in a floating lavender world.",
        },
      ],
    },
  };
}
export function landingMetadata(
  env: Record<string, string | undefined> = process.env,
): Metadata {
  const origin = publicOrigin(env);
  return {
    title: { absolute: siteTitle },
    ...(origin
      ? {
          alternates: { canonical: origin },
          openGraph: { ...brandMetadata(env).openGraph, url: origin },
        }
      : {}),
    robots: origin
      ? { index: true, follow: true }
      : { index: false, follow: false },
  };
}
export function siteRobots(
  env: Record<string, string | undefined> = process.env,
): MetadataRoute.Robots {
  const origin = publicOrigin(env);
  return origin
    ? {
        rules: {
          userAgent: "*",
          allow: "/",
          disallow: ["/app", "/login", "/connect", "/api/", "/auth/"],
        },
        sitemap: `${origin}/sitemap.xml`,
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}
export function siteSitemap(
  env: Record<string, string | undefined> = process.env,
): MetadataRoute.Sitemap {
  const origin = publicOrigin(env);
  return origin
    ? [{ url: origin, changeFrequency: "monthly", priority: 1 }]
    : [];
}
