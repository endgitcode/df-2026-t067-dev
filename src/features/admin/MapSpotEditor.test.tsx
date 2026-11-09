import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { MapSpotEditor } from './MapSpotEditor'
import { initialSpotInput, spotForDraft } from './mapsSpotLink'
import type { MapPlaceDetails } from './ShootingAreasMap'

const mock = vi.hoisted(() => ({ first: vi.fn<() => Promise<MapPlaceDetails>>(), second: vi.fn<() => Promise<MapPlaceDetails>>() }))
vi.mock('./ShootingAreasMap', () => ({
  ShootingAreasMap: ({ onSelect }: { onSelect: (lat: number, lng: number, place: { id: string; loadDetails: () => Promise<MapPlaceDetails> }) => void }) => <>
    <button onClick={() => onSelect(35, 135, { id: 'old', loadDetails: mock.first })}>地図の場所A</button>
    <button onClick={() => onSelect(36, 136, { id: 'new', loadDetails: mock.second })}>地図の場所B</button>
  </>,
}))

it('shows only the latest map candidates and keeps provider text out of saved spot values', async () => {
  const user = userEvent.setup()
  let finishFirst!: (value: MapPlaceDetails) => void
  mock.first.mockReturnValue(new Promise((resolve) => { finishFirst = resolve }))
  mock.second.mockResolvedValue({ name: '地図の名称候補', address: '地図の住所候補' })
  function Harness() {
    const [input, setInput] = useState(initialSpotInput)
    return <>
      <MapSpotEditor input={input} invalid={false} orgId="fixture" onChange={setInput} />
      <output data-testid="spot">{JSON.stringify(spotForDraft(input))}</output>
    </>
  }
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: '地図を開いて場所を選ぶ' }))
  await user.click(screen.getByRole('button', { name: '地図の場所A' }))
  await user.click(screen.getByRole('button', { name: '地図の場所B' }))
  expect(await screen.findByText('名称候補：地図の名称候補')).toBeVisible()
  expect(screen.getByText('住所候補：地図の住所候補')).toBeVisible()
  expect(screen.getByLabelText('確認済み住所')).toHaveValue('')
  await act(() => finishFirst({ name: '古い候補' }))
  expect(screen.queryByText(/古い候補/)).not.toBeInTheDocument()
  expect(screen.getByTestId('spot')).toHaveTextContent('incomplete')
  await user.type(screen.getByLabelText('スポット名・施設名'), '自治体の名称')
  await user.type(screen.getByLabelText('確認済み住所'), '自治体の住所')
  expect(JSON.parse(screen.getByTestId('spot').textContent ?? '')).toEqual({
    name: '自治体の名称', address: '自治体の住所', position: { latitude: 36, longitude: 136 }, googlePlaceId: 'new',
  })
})
