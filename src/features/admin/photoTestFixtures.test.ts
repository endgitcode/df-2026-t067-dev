import { expect, it } from 'vitest'
import serverSource from '../../../server/src/demo-photo-test.ts?raw'
import { matchFixturePngBase64, otherFixturePngBase64 } from './photoTestFixtures'

function serverFixtureBase64(name: string): string {
  const found = new RegExp(`export const ${name} = Buffer\\.from\\('([^']+)', 'base64'\\)`).exec(serverSource)
  if (!found) throw new Error(`server fixture ${name} not found`)
  return found[1]
}

it('downloads exactly the PNG bytes the server fixture matcher accepts', () => {
  expect(matchFixturePngBase64).toBe(serverFixtureBase64('syntheticPng'))
  expect(otherFixturePngBase64).toBe(serverFixtureBase64('otherSyntheticPng'))
  for (const base64 of [matchFixturePngBase64, otherFixturePngBase64]) {
    const binary = atob(base64)
    // PNG signature.
    expect([...binary.slice(0, 4)].map((char) => char.charCodeAt(0))).toEqual([0x89, 0x50, 0x4e, 0x47])
  }
  expect(matchFixturePngBase64).not.toBe(otherFixturePngBase64)
})
