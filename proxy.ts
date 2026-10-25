import { NextResponse, type NextRequest } from "next/server";
import { runtimeConfig } from "./src/server/config";
import { resolvePageAccess } from "./src/server/page-access";

export async function proxy(request: NextRequest) {
  let config;
  try {
    config = runtimeConfig();
  } catch {
    const response = request.nextUrl.pathname.startsWith("/app")
      ? NextResponse.redirect(new URL("/login", request.url))
      : NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (request.headers.get("host") !== new URL(config.origin).host)
    return new NextResponse("Invalid host", { status: 403 });
  const { destination, headers } = await resolvePageAccess(request, config);
  const response = destination
    ? NextResponse.redirect(new URL(destination, config.origin))
    : NextResponse.next();
  // Rendered pages do not read sessions. Send refreshed cookies to the browser;
  // subsequent data requests still verify authorization in their route handlers.
  headers.forEach((value, name) => {
    if (name !== "set-cookie") response.headers.set(name, value);
  });
  for (const cookie of headers.getSetCookie())
    response.headers.append("Set-Cookie", cookie);
  if (request.nextUrl.pathname !== "/")
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
export const config = { matcher: ["/", "/login", "/app/:path*"] };
