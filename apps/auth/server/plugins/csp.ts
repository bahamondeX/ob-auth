import { createHash } from 'node:crypto'
import { setResponseHeader } from 'h3'

export default defineNitroPlugin(nitro => {
  nitro.hooks.hook('render:html', (html, { event }) => {
    const inline = [html.head, html.bodyPrepend, html.body, html.bodyAppend].flat().join('\n')
    const hashes = [...inline.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(match => match[1])
      .filter(Boolean)
      .map(content => "'sha256-" + createHash('sha256').update(content!).digest('base64') + "'")
    const dev = process.env.NODE_ENV !== 'production'
    setResponseHeader(event, 'content-security-policy', [
      "default-src 'none'",
      "script-src 'self' " + hashes.join(' ') + (dev ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'" + (dev ? ' ws: wss:' : ''),
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "manifest-src 'self'"
    ].join('; '))
  })
})
