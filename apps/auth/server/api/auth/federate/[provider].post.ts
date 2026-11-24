import { z } from 'zod'
import { startFederation } from '../../../utils/federation'
import { csrf, httpError, safeError } from '../../../utils/http'
import { runtime } from '../../../utils/runtime'

export default defineEventHandler(async event => {
  try {
    csrf(event)
    const provider = z.enum(['google', 'microsoft', 'github']).safeParse(getRouterParam(event, 'provider'))
    if (!provider.success) throw httpError(404, 'Provider unavailable')
    return await startFederation(event, await runtime(), provider.data)
  } catch (error) {
    throw safeError(error)
  }
})
