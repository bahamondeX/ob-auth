import { getRequestURL, setResponseHeaders } from 'h3'

export default defineEventHandler(event => {
  const pathname = getRequestURL(event).pathname
  setResponseHeaders(event, {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'strict-transport-security': 'max-age=31536000',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...(!pathname.startsWith('/_nuxt/') ? { 'cache-control': 'no-store' } : {})
  })
})
