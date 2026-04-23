import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || ''

  // Only handle HTTP Basic auth here.
  // Bearer tokens are used by app APIs (e.g. Supabase access_token) and must NOT be decoded as base64.
  if (authHeader.toLowerCase().startsWith('basic ')) {
    const authValue = authHeader.slice(6).trim()
    try {
      const [user, pwd] = atob(authValue).split(':')

      if (user === 'admin' && pwd === 'titkos123') {
        return NextResponse.next()
      }
    } catch {
      // Invalid Basic header → fall through to 401.
    }
  }

  return new NextResponse('Auth required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  })
}

export const config = {
  // Don't block API routes with Basic auth.
  matcher: [
    '/((?!api/).*)',
  ],
}