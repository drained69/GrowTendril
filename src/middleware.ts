import { NextResponse, type NextRequest } from "next/server";

/**
 * Coarse gate (cookie presence). Signature verification happens server-side; security headers
 * (CSP, HSTS, frame/nosniff/referrer/permissions) are set for every route in next.config.ts.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if ((pathname.startsWith("/app") || pathname.startsWith("/onboarding")) && !req.cookies.get("gos_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
