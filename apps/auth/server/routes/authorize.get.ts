import { runtime } from '../utils/runtime'
import { safeError } from '../utils/http'
import { authorize } from '../utils/relying-party'

export default defineEventHandler(async event => {
  try {
    return await authorize(event, await runtime())
  } catch (error) {
    throw safeError(error)
  }
})
