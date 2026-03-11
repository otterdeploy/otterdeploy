import { pub } from '../orpc'

const MAX_EVENTS = 5

export const sse = pub.sse
  .handler(async function* () {
    let count = 0

    while (count < MAX_EVENTS) {
      count++
      yield { time: new Date() }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })
