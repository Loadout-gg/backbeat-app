import { afterEach, expect, test, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@vercel/analytics/next', () => ({ Analytics: () => createElement('span', { 'data-analytics': 'enabled' }) }))
vi.mock('next/font/google', () => ({ Geist: () => ({}), Geist_Mono: () => ({}), Source_Serif_4: () => ({}) }))
import RootLayout from '@/app/layout'

afterEach(() => vi.unstubAllEnvs())

test('isolated development does not load Vercel Analytics', () => {
  vi.stubEnv('BACKBEAT_ENV', 'development')
  const html = renderToStaticMarkup(RootLayout({ children: createElement('p', null, 'Local demo') }))
  expect(html).not.toContain('data-analytics="enabled"')
})

test('existing non-development analytics behavior is preserved', () => {
  vi.stubEnv('BACKBEAT_ENV', undefined)
  vi.stubEnv('NEXT_PUBLIC_BACKBEAT_ENV', undefined)
  const html = renderToStaticMarkup(RootLayout({ children: createElement('p', null, 'Page') }))
  expect(html).toContain('data-analytics="enabled"')
})
