import { getQuery, sendRedirect } from 'h3'
import { safeError } from '../utils/http'
import { beginLogout } from '../utils/relying-party'
import { runtime } from '../utils/runtime'

export default defineEventHandler(async event => {
  try {
    if (!Object.keys(getQuery(event)).length) return sendRedirect(event, '/?view=logout', 303)
    return await beginLogout(event, await runtime())
  } catch (error) {
    throw safeError(error)
  }
})
