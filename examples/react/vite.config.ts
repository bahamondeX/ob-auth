import { defineConfig, loadEnv } from 'vite'
import { toNodeListener } from 'h3'
import { createBff } from './bff.ts'

export default defineConfig(({ mode }) => ({
  plugins: [{
    name: 'ob-auth-backend-for-frontend',
    configureServer(server) {
      const env = { ...loadEnv(mode, process.cwd(), 'OB_AUTH_'), ...process.env }
      if (!env.OB_AUTH_CLIENT_SECRET || !env.OB_AUTH_SESSION_KEY) {
        throw new Error('Set OB_AUTH_CLIENT_SECRET and OB_AUTH_SESSION_KEY in the React example .env')
      }
      const listener = toNodeListener(createBff(env))
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path?.startsWith('/auth/') || path === '/api/protected') return listener(req, res)
        return next()
      })
    },
  }],
}))
