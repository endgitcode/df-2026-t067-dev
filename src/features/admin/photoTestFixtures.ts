// Byte-identical copies of the server photo-test fixtures in
// server/src/demo-photo-test.ts. The fixture matcher compares normalized
// bytes, so these downloads must match the server definition exactly;
// photoTestFixtures.test.ts pins them to the server source.
// Generated 2x2 pictures. The first is the reference and matching candidate.
export const matchFixturePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg=='
export const otherFixturePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWNgYPgPRmAKABf2A/38FIMyAAAAAElFTkSuQmCC'

export function fixturePngUrl(base64: string): string {
  return `data:image/png;base64,${base64}`
}
