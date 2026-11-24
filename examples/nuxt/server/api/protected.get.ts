export default defineEventHandler(async (event) => {
  const session = await requireObAuth(event)
  return { sub: session.user.sub }
})
