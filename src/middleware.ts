import { NextRequest, NextResponse } from "next/server";

/**
 * Keeps the whole session on one origin.
 *
 * A Vercel project also answers on a distinct URL for every deployment. Start
 * sign-in on one of those and the OAuth state and PKCE cookies are stored
 * against that host, but AUTH_URL sends GitHub's callback to the canonical one
 * — the cookies are never sent back, the check fails, and Auth.js reports it as
 * a configuration error. Redirecting up front means the flow starts and ends in
 * the same cookie jar.
 *
 * Inactive unless AUTH_URL is set, so local development is unaffected.
 */
export function middleware(req: NextRequest) {
  const canonical = process.env.AUTH_URL;
  if (!canonical) return NextResponse.next();

  let target: URL;
  try {
    target = new URL(canonical);
  } catch {
    return NextResponse.next(); // malformed AUTH_URL: better to serve than loop
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host || host === target.host) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.protocol = target.protocol;
  url.host = target.host;
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
