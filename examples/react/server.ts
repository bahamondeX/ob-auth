import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { toNodeListener } from 'h3'
import { createBff } from './bff.ts'

const listener = toNodeListener(createBff(process.env))
const assets = resolve('dist')
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
}
const server = createServer(async (request, response) => {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  } catch {
    response.writeHead(400).end()
    return
  }
  if (pathname.startsWith('/auth/') || pathname === '/api/protected') {
    await listener(request, response)
    return
  }
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end()
    return
  }
  const file = resolve(assets, pathname === '/' ? 'index.html' : '.' + pathname)
  if (!file.startsWith(assets + sep) || !Object.hasOwn(mimeTypes, extname(file))) {
    response.writeHead(404).end()
    return
  }
  try {
    const body = await readFile(file)
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(file)]!,
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache',
    }).end(body)
  } catch {
    response.writeHead(404).end()
  }
})

server.listen(Number(process.env.PORT || 3102), process.env.HOST || 'localhost')
