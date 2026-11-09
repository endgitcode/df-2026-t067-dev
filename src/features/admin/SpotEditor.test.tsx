import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import type { ManagedQuest, OrgMembership } from '../../shared/api'
import { parseDurableMapsLink, parseMapsSpotLink } from './mapsSpotLink'
import QuestDraftForm from './QuestDraftForm'

const member: OrgMembership = { orgId: 'test-org', areaId: 'n03-00001-2025', label: 'テスト自治体', role: 'editor',
  municipalityCode: '00001', exploration: { source: 'N03', name: '区域テスト', municipalityCode: '00001', year: 2025 } }

it('saves a complete Maps spot without a confirmation checkbox and restores it independently of the capture range', async () => {
  const user = userEvent.setup()
  const createManagedQuest = vi.fn<typeof api.createManagedQuest>(async (orgId, draft) => ({
    orgId, areaId: member.areaId, questId: 'test-quest', draftRevision: 1, publishedVersion: null,
    source: 'real', status: 'draft', shootingAreaStatus: 'unconfigured', draft,
  }))
  const api = createApiClient()
  const connection = { api: { ...api, createManagedQuest }, initial: null as ManagedQuest | null, member, onBack: vi.fn() }
  const view = render(<QuestDraftForm teamPreview connection={connection} />)
  expect(screen.getByText(/区域テスト/)).toBeVisible()
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://www.google.com/maps/place/Pin/@35,139,15z/data=!3d36!4d140')
  await user.click(screen.getByRole('button', { name: 'リンクから場所を取得' }))
  expect(screen.getByLabelText('スポットの緯度')).toHaveValue('36')
  await user.type(screen.getByLabelText('スポット名・施設名'), '施設')
  await user.type(screen.getByLabelText('確認済み住所'), '確認住所')
  expect(screen.queryByRole('checkbox', { name: '位置・スポット名・住所を確認した' })).not.toBeInTheDocument()
  await user.clear(screen.getByLabelText('スポットの経度'))
  await user.type(screen.getByLabelText('スポットの経度'), '181')
  await user.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(createManagedQuest).not.toHaveBeenCalled()
  expect(screen.getByText('対象スポットの名称・住所と、有効な緯度・経度を入力してください。')).toBeVisible()
  await user.clear(screen.getByLabelText('スポットの経度'))
  await user.type(screen.getByLabelText('スポットの経度'), '141')
  await user.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(await screen.findByText('下書きを保存しました。')).toBeVisible()
  const saved = await createManagedQuest.mock.results[0].value
  expect(saved.draft.afterClear.spot).toEqual({ name: '施設', address: '確認住所', position: { latitude: 36, longitude: 141 } })
  view.unmount()
  render(<QuestDraftForm teamPreview connection={{ ...connection, initial: saved }} />)
  expect(screen.getByLabelText('確認済み住所')).toHaveValue('確認住所')
  expect(screen.getByLabelText('スポットの経度')).toHaveValue('141')
  expect(screen.getByLabelText('Google Maps共有URL')).toHaveValue('')
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://www.google.com/maps/search/?api=1&query=place_id:ChIJ_other')
  await user.click(screen.getByRole('button', { name: 'リンクから場所を取得' }))
  expect(screen.getByText('ChIJ_other')).toBeVisible()
  expect(screen.getByLabelText('スポット名・施設名')).toHaveValue('')
  expect(screen.getByLabelText('確認済み住所')).toHaveValue('')
  expect(screen.getByLabelText('スポットの緯度')).toHaveValue('')
})

it('leaves manual inputs usable after an unresolved short link', async () => {
  const user = userEvent.setup()
  render(<QuestDraftForm teamPreview connection={{ api: createApiClient(), initial: null, member, onBack: vi.fn() }} />)
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://maps.app.goo.gl/test?ignored=true')
  await user.click(screen.getByRole('button', { name: 'リンクから場所を取得' }))
  expect(screen.getByText(/表示されたURLを貼り直してください/)).toBeVisible()
  expect(screen.getByRole('link', { name: /Google Mapsで短縮リンクを開く/ })).toHaveAttribute('href', 'https://maps.app.goo.gl/test')
  await user.type(screen.getByLabelText('スポットの緯度'), '36')
  await user.type(screen.getByLabelText('スポットの経度'), '140')
  await user.type(screen.getByLabelText('スポット名・施設名'), '施設')
  await user.type(screen.getByLabelText('確認済み住所'), '住所')
  expect(screen.getByLabelText('スポットの緯度')).toHaveValue('36')
  expect(screen.getByLabelText('確認済み住所')).toHaveValue('住所')
})

it('parses only permitted Maps links and separates labels, coordinate pins and Place IDs', () => {
  expect(parseDurableMapsLink('https://www.google.com/maps/place/Example+Hall/@1,2,15z/data=!3d35!4d139!1sChIJfixture'))
    .toMatchObject({ kind: 'place', position: { latitude: 35, longitude: 139 }, label: 'Example Hall', googlePlaceId: 'ChIJfixture' })
  expect(parseDurableMapsLink('https://www.google.com/maps/search/?api=1&query=Example+Hall')).toMatchObject({ kind: 'place', position: null, label: 'Example Hall' })
  expect(parseDurableMapsLink('https://maps.google.co.jp/?q=35,139')).toMatchObject({ kind: 'place', position: { latitude: 35, longitude: 139 } })
  expect(parseDurableMapsLink('https://goo.gl/maps/sample')).toEqual({ kind: 'short', href: 'https://goo.gl/maps/sample' })
  for (const url of ['http://maps.app.goo.gl/test', 'https://maps.app.goo.gl@127.0.0.1/test', 'https://www.google.com.evil.test/maps?q=1,2']) {
    expect(parseDurableMapsLink(url)).toEqual({ kind: 'invalid' })
  }
  for (const url of ['https://www.google.com/maps/@35,139,15z', 'https://www.google.com/maps/dir/Start/End',
    'https://www.google.com/maps/place/Hall/data=!3d35!4d139?q=36,139',
    'https://www.google.com/maps/search/?query=place_id:ChIJ_first&query_place_id=ChIJ_second']) {
    expect(parseDurableMapsLink(url)).toEqual({ kind: 'unsupported' })
  }
})

it('does not infer a spot from the viewport, an arbitrary host, or a directions URL', () => {
  for (const url of ['https://www.google.com/maps/@35,139,18z', 'https://www.google.com.attacker.test/maps?q=35,139',
    'https://www.google.com/maps/dir/Start/End/data=!3d35!4d139', 'https://www.google.com@127.0.0.1/maps?q=35,139']) {
    expect(parseMapsSpotLink(url).position).toBeFalsy()
  }
  expect(parseMapsSpotLink('https://www.google.com/maps/search/?api=1&query=35,139&query_place_id=ChIJ_example'))
    .toMatchObject({ position: { latitude: 35, longitude: 139 }, googlePlaceId: 'ChIJ_example' })
})
