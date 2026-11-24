import { federationCallback } from '../../utils/federation'
import { runtime } from '../../utils/runtime'

export default defineEventHandler(async event => {
  try {
    return await federationCallback(event, await runtime())
  } catch {
    return sendRedirect(event, '/?error=federation', 303)
  }
})
