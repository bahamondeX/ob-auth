import { linkCallback } from '../../utils/federation'
import { runtime } from '../../utils/runtime'

export default defineEventHandler(async event => {
  try {
    return await linkCallback(event, await runtime())
  } catch {
    return sendRedirect(event, '/?error=link', 303)
  }
})
