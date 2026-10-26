import { expect, it } from 'vitest'
import { eventDateParts } from '@/lib/event-date-display'

it('keeps the exact stored day and month at a month boundary', () => {
  expect(eventDateParts('2030-03-01')).toEqual({ month: 'Mar', day: '1' })
})
it('accepts a real leap day without host-timezone interpretation', () => {
  expect(eventDateParts('2028-02-29')).toEqual({ month: 'Feb', day: '29' })
})
it.each(['2030-02-30', 'infinity', 'not-a-date', '2030-03-01T00:00:00Z'])('rejects a non-calendar date %s', value => {
  expect(eventDateParts(value)).toEqual({ month: '?', day: '?' })
})
