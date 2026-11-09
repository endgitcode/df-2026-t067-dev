# 自治体管理画面の素材の事前承認

永続管理画面の4ステップでは写真の権利文を入力しない。下書きには未承認の参考写真・ヒント画像も保存できる。公開条件の確認と公開確定時に、参考写真とすべてのヒント画像を照合する。写真試験は参考写真と試験写真が承認済みの場合だけ受け付け、試験結果にも試験写真の識別値を保持する。公開確定時に一致・別対象の両方の承認を再確認する。既に公開した版や旅行者の記録は変更しない。

## 運営が登録する

権利を確認した運営担当者が、対象環境の Firestore `adminPhotoApprovals` に下記の文書を登録する。ブラウザの利用者に作成・更新権限は付けない。登録対象、許諾の根拠、確認者は運営側の承認記録に残す。

| 項目 | 値 |
| --- | --- |
| 文書ID | SHA-256（UTF-8の `JSON.stringify([orgId, purpose, digest])`、小文字16進） |
| `orgId` | 対象自治体の組織ID |
| `purpose` | `reference`（参考写真）、`public_hint`（ヒント画像）、`photo_test`（一致・別対象試験）のいずれか |
| `digest` | 登録対象の元ファイルのSHA-256（小文字16進） |
| `active` | 承認を有効にするときのみ `true` |

例えば、次のコマンドは承認登録用の値をローカルに出力するだけで、Firestoreへの書き込みは行わない。

```sh
node -e 'const fs=require("node:fs"),h=(x)=>require("node:crypto").createHash("sha256").update(x).digest("hex"); const [orgId,purpose,file]=process.argv.slice(1); const digest=h(fs.readFileSync(file)); console.log(JSON.stringify({id:h(JSON.stringify([orgId,purpose,digest])),data:{orgId,purpose,digest,active:true}},null,2));' <orgId> <purpose> <file>
```

同じ写真でも別の組織や用途に自動で承認は引き継がれない。合成試験モードも例外にせず、運営が対象組織に一致用写真を `reference` と `photo_test`、別対象用写真を `photo_test` として登録する。実Vertexモードでは承認した実写真を登録する。承認されていない入力は試験照合やその回数枠の消費前に拒否する。照合方式や回数上限の設定は既存のまま。

STEP 4は同じ下書き版を開いている間、工程移動の前後で試験結果を保持する。再ログインやページ再読み込み後の証跡復元は未実装。実装する場合は、認証済みの所属、問題・下書き版、参考写真の保存世代、照合モード、用途別の現在の承認、異なる写真の試験結果をサーバーで照合し、IDと結果だけを返す。

旧素材で `orgAssets/{assetId}.approvalDigest` がない場合は、その文書の既存の `digest` を登録用の識別値に使う。保存済み素材を運営が確認してから登録し、古い権利文だけでは承認しない。既存の試験結果に識別値がない場合は承認済みの写真で試験をやり直す。承認の取り消しは `active: false` にし、以後の公開を止める。

永続側の素材アップロード・写真試験では旧クライアントの `photoRights` も受け付けるが承認の根拠にしない。公開リクエストでは `confirmations.photoRights` の省略を許容する。旧デモAPIの入力契約は従来どおり。A担当のレビュー対象は、運営だけが書き込めること、既存組織の登録計画、取消時の公開制御、エミュレーターでの確認。
