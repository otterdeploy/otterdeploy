import type { z } from 'zod'
import type { UserSchema } from './schemas/user'
import { implement, ORPCError } from '@orpc/server'
import { dbProviderMiddleware } from './middlewares/db'
import { contract } from './contract'

export interface ORPCContext {
  user?: z.infer<typeof UserSchema>
}

export const pub = implement(contract)
  .$context<ORPCContext>()
  .use(dbProviderMiddleware)

export const authed = pub.use(({ context, next }) => {
  if (!context.user) {
    throw new ORPCError('UNAUTHORIZED')
  }

  return next({
    context: {
      user: context.user,
    },
  })
})
