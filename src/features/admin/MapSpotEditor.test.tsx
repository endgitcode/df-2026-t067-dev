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

it('uses only the latest map candidates after explicit confirmation', async () => {
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
  await user.click(screen.getByRole('button', { name: '地図' }))
  await user.click(screen.getByRole('button', { name: '地図の場所A' }))
  await user.click(screen.getByRole('button', { name: '地図の場所B' }))
  expect(await screen.findByText('名称候補：地図の名称候補')).toBeVisible()
  expect(screen.getByText('住所候補：地図の住所候補')).toBeVisible()
  expect(screen.getByLabelText('住所')).toHaveValue('')
  await act(() => finishFirst({ name: '古い候補' }))
  expect(screen.queryByText(/古い候補/)).not.toBeInTheDocument()
  expect(screen.getByTestId('spot')).toHaveTextContent('incomplete')
  await user.click(screen.getByRole('button', { name: '名前・住所を使う' }))
  expect(screen.getByLabelText('場所の名前')).toHaveValue('地図の名称候補')
  expect(screen.getByLabelText('住所')).toHaveValue('地図の住所候補')
  expect(JSON.parse(screen.getByTestId('spot').textContent ?? '')).toEqual({
    name: '地図の名称候補', address: '地図の住所候補', position: { latitude: 36, longitude: 136 }, googlePlaceId: 'new',
  })
})

it('keeps manually entered values when a map candidate omits them', async () => {
  const user = userEvent.setup()
  mock.first.mockResolvedValue({ address: '候補の住所' })
  function Harness() {
    const [input, setInput] = useState(initialSpotInput)
    return <MapSpotEditor input={input} invalid={false} orgId="fixture" onChange={setInput} />
  }
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: '地図' }))
  await user.click(screen.getByRole('button', { name: '地図の場所A' }))
  await screen.findByText('住所候補：候補の住所')
  await user.type(screen.getByLabelText('場所の名前'), '手入力の場所')
  await user.click(screen.getByRole('button', { name: '名前・住所を使う' }))
  expect(screen.getByLabelText('場所の名前')).toHaveValue('手入力の場所')
  expect(screen.getByLabelText('住所')).toHaveValue('候補の住所')
  expect(screen.getByLabelText('緯度')).toHaveValue('35')
  expect(screen.getByLabelText('経度')).toHaveValue('135')
})


it('toggles the map with the same button', async () => {
  const user = userEvent.setup()
  render(<MapSpotEditor input={initialSpotInput()} invalid={false} orgId="fixture" onChange={vi.fn()} />)
  const toggle = screen.getByRole('button', { name: '地図' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: '地図の場所A' })).toBeVisible()
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: '地図の場所A' })).not.toBeInTheDocument()
})
