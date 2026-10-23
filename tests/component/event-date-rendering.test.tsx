import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('@/lib/actions/events', () => ({
  listEvents: async () => [{
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: '22222222-2222-4222-8222-222222222222',
    title: 'Synthetic month boundary', date: '2030-03-01',
    location: null, status: 'in_progress', artist_id: null,
    promoter_id: null, created_at: '2030-01-01T00:00:00Z',
    artists: null, promoters: null,
  }],
}))
import EventsPage from '@/app/dashboard/events/page'

it('renders the stored March first even on a west-of-UTC server', async () => {
  const html = renderToStaticMarkup(await EventsPage())
  expect(html).toMatch(/>Mar<\/span>/)
  expect(html).toMatch(/>1<\/span>/)
})
