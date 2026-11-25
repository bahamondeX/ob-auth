import { addImports, addRouteMiddleware, addServerHandler, addServerImports, createResolver, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'
import type { ServerAuthOptions } from '../server/index.ts'

const obAuth: NuxtModule<Required<ServerAuthOptions>> = defineNuxtModule<Required<ServerAuthOptions>>({
  meta: { name: '@oscarbahamonde/ob-auth', configKey: 'obAuth', compatibility: { nuxt: '^4.0.0' } },
  defaults: { domain: 'https://auth.oscarbahamonde.com', clientId: '', appOrigin: '', clientSecret: '', sessionKey: '', logoutUri: '' },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    nuxt.options.runtimeConfig.obAuth = { ...options, ...(nuxt.options.runtimeConfig.obAuth as Partial<Required<ServerAuthOptions>> | undefined) }
    addImports({ name: 'useAuth', from: resolver.resolve('runtime/useAuth') })
    addRouteMiddleware({ name: 'ob-auth', path: resolver.resolve('runtime/middleware') })
    addServerImports({ name: 'requireObAuth', from: resolver.resolve('runtime/server') })
    for (const [operation, method] of [['login', 'get'], ['callback', 'get'], ['session', 'get'], ['logout', 'post']] as const) {
      addServerHandler({ route: '/auth/' + operation, method, handler: resolver.resolve('runtime/handler') })
    }
  },
})

export default obAuth
