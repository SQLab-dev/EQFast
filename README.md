# EQFast

地震情報を取得して表示するプロジェクトです。

- 地震情報の受信
- 過去の地震情報の表示(現在は履歴のみ)
- 強震モニタからの観測点色取得

に対応しています。

## クレジット

- 地震情報・履歴の取得 : [P2P地震情報 API](https://www.p2pquake.net/develop/json_api_v2/)
- リアルタイム震度・加速度 : [NIED強震モニタ](http://www.kmoni.bosai.go.jp/)
- 効果音 : [OtoLogic](https://otologic.jp/)
- 地図データ : [気象庁](https://www.jma.go.jp/)

その他クレジットはアプリ内に記載しています。

## 参考資料

- [強震モニタから震度と加速度を取る](https://note.com/t0729/n/n749814e492cd)
- [多項式補間を使用して強震モニタ画像から数値データを決定する](https://qiita.com/NoneType1/items/a4d2cf932e20b56ca444)

## 注意事項

このプロジェクトは、防災科学技術研究所、P2P地震情報(開発者:たくや様)、気象庁、その他のサービスとは一切関係ありません。本プロジェクトに関するお問い合わせは[こちら](https://docs.google.com/forms/d/e/1FAIpQLSdB071foWH-0Wb1YMfDrvUOZAJoRu3RKJXG1gtZmK4GCN-g_g/viewform)までお願いします。

## 実行方法 (Next.js)

このリポジトリは、既存の `assets/` と `data/` を保持したまま Next.js で起動できる構成に移行しています。

1. 依存パッケージをインストール

```bash
npm install
```

1. 開発サーバーを起動

```bash
npm run dev
```

1. ブラウザで確認

```text
http://localhost:3000
```

### 補足

- 既存のプレーン HTML エントリである `index.html` は互換性確認のため残しています。
- Next.js 実行時は `server.cjs` が `/assets` と `/data` を静的配信するため、既存の JS の相対パスを変更せずに動作します。
