import { NextResponse, type NextRequest } from "next/server";

/** Basic-auth gate for the dashboard pages. API routes use their own keys. */
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try { decoded = atob(header.slice(6)); } catch { decoded = ""; }
    const idx = decoded.indexOf(":");
    if (idx >= 0 && decoded.slice(idx + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Spamtext"' } });
}

export const config = { matcher: ["/((?!api/|_next/|favicon.ico).*)"] };
