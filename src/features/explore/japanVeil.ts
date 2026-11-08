// 日本の外側を薄く落とすベール（D-41）のパス組み立て。
// ベールは「日本周辺を覆う外周リング」から「明るく残す範囲」を穴としてくり抜いたポリゴンで、
// Google Maps の Polygon は、外周と穴の巻き方向が逆向きのときに穴として扱う（公式ドキュメントの仕様）。
// 座標は [経度, 緯度] の並びで保持し、組み立て時に {lat, lng} へ変換する。

// ベールの外周。明るく残す円を「穴」としてくり抜くための土台リングで、巻き方向は穴とは逆向き（反時計回り）。
// 世界全体（経度±180・緯度±85）の矩形を外周にしてはいけない。その角は球面上では経度±180で一致して潰れ、
// 内側の判定が反転して「日本だけが塗られる」結果になる（2026-11-08 に実機スクリーンショットで確認した不具合の原因）。
// そこで外周は、移動制限（東経122〜147度・北緯23〜46.5度）と最小ズーム 4.5 のもとで見える範囲を余裕を持って覆う
// 東経90〜179度・北緯0〜65度の矩形にする。球面に占める割合は約2割で、穴あきポリゴンの外周として安定する大きさに収まる。
export const JAPAN_VEIL_OUTER_RING: ReadonlyArray<readonly [number, number]> = [
  [90, 0], [179, 0], [179, 65], [90, 65], [90, 0],
]

// 明るく残す範囲は、日本の輪郭ではなく円形のスポットライトにする（2026-11-08 のユーザー判断で D-41 を変更）。
// 輪郭なぞりは縁がギザギザで硬く見えたため、日本列島がすっぽり入る大きな円の内側だけを通常表示にし、
// 外側をベールで落とす。円は画面固定ではなく地理的な円で、地図を動かしても日本に追随する。
// 中心と半径の決め方：デモ地域の両端である那覇（127.6809, 26.2124）と札幌（141.3544, 43.0621）を結ぶ
// 対角（大円距離 2,246km）の球面中点を中心とし、その半分（1,123km）に約150kmの余白を足した 1,275km を半径とする。
// この円には10のデモ地域すべての代表点が入り、最も遠い那覇・札幌でも縁まで約150kmの余裕がある。
// 代償として、近さゆえにソウルや上海など近隣の沿岸も円の内側（明るい側）に入る。円である以上避けられない割り切りとする。
export const JAPAN_VEIL_SPOTLIGHT_CENTER = { lat: 34.8267, lng: 133.8148 }
export const JAPAN_VEIL_SPOTLIGHT_RADIUS_KM = 1275

const EARTH_RADIUS_KM = 6371
const SPOTLIGHT_SEGMENTS = 72

// 球面上の目的地（中心から方位角と距離を指定して到達する点）を [経度, 緯度] で返す。
// 緯度による経度の歪みは大円の式でそのまま扱うため、平面近似の楕円にはならない。
function destinationPoint(bearingDeg: number): readonly [number, number] {
  const delta = JAPAN_VEIL_SPOTLIGHT_RADIUS_KM / EARTH_RADIUS_KM
  const theta = (bearingDeg * Math.PI) / 180
  const phi1 = (JAPAN_VEIL_SPOTLIGHT_CENTER.lat * Math.PI) / 180
  const lambda1 = (JAPAN_VEIL_SPOTLIGHT_CENTER.lng * Math.PI) / 180
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  const phi2 = Math.asin(sinPhi2)
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * sinPhi2,
  )
  return [(lambda2 * 180) / Math.PI, (phi2 * 180) / Math.PI]
}

// スポットライトの円周リング（閉じたリング）。方位角 0→360 度の順に点を打つと、
// 経度・緯度の平面では時計回り（外周とは逆向き）になり、穴として扱われる向きに揃う。
export const JAPAN_VEIL_SPOTLIGHT_RING: ReadonlyArray<readonly [number, number]> = (() => {
  const ring: Array<readonly [number, number]> = []
  for (let i = 0; i < SPOTLIGHT_SEGMENTS; i++) {
    ring.push(destinationPoint((i * 360) / SPOTLIGHT_SEGMENTS))
  }
  ring.push(ring[0])
  return ring
})()

// ベールのパス一式（先頭が外周、次がスポットライトの円＝穴）を Google Maps の {lat, lng} 形式で組み立てる。
export function buildJapanVeilPaths(): Array<Array<{ lat: number; lng: number }>> {
  return [JAPAN_VEIL_OUTER_RING, JAPAN_VEIL_SPOTLIGHT_RING].map((ring) => ring.map(([lng, lat]) => ({ lat, lng })))
}
