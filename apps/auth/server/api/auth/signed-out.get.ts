import { sendRedirect } from 'h3'
import { safeError } from '../../utils/http'
import { logoutDestination } from '../../utils/relying-party'
import { runtime } from '../../utils/runtime'

export default defineEventHandler(async event => {
  try {
    const destination = await logoutDestination(event, await runtime(), true)
    return sendRedirect(event, destination?.url ?? '/', 303)
  } catch (error) {
    throw safeError(error)
  }
})
