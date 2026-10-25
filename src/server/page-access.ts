import { requestClient, requireUser } from "./supabase.ts";
import type { RuntimeConfig } from "./config.ts";

export function pageDestination(
  path: string,
  signedIn: boolean,
  mode: RuntimeConfig["mode"],
) {
  // SQLite is an explicit loopback-only development mode, never a hosted fallback.
  if (mode === "sqlite") return null;
  if ((path === "/app" || path.startsWith("/app/")) && !signedIn)
    return "/login";
  if ((path === "/" || path === "/login") && signedIn) return "/app";
  return null;
}
export async function resolvePageAccess(
  request: Request,
  config: RuntimeConfig,
  verify = async (
    request: Request,
    config: Extract<RuntimeConfig, { mode: "supabase" }>,
    headers: Headers,
  ) => {
    await requireUser(requestClient(request, config, headers));
  },
) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  });
  let signedIn = false;
  if (config.mode === "supabase") {
    try {
      await verify(request, config, headers);
      signedIn = true;
    } catch {
      /* Invalid, anonymous and unavailable sessions never unlock the dashboard. */
    }
  }
  return {
    destination: pageDestination(
      new URL(request.url).pathname,
      signedIn,
      config.mode,
    ),
    headers,
  };
}
