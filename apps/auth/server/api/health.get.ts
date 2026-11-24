import { safeError } from '../utils/http'
import { runtime } from '../utils/runtime'

export default defineEventHandler(async () => {
  try {
    // Initialization checks the workload's access to the confidential client.
    await runtime()
    return { service: 'ob-auth', status: 'ok' }
  } catch (error) {
    throw safeError(error)
  }
})
