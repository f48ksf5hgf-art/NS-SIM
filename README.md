# NS-SIM

警備・災害対応シミュレーションゲーム（試作版）。
React + TypeScript + Vite 製のレスポンシブ Web アプリで、MacBook・iPad・iPhone のブラウザで動作します。

## シナリオ 01：商業施設 自動火災報知設備 発報

架空の商業施設「NSショッピングプラザ」の防災センター指令担当として、警備員3名に指示を出し、火災報知設備の発報に対応します。

| 区域 | 階 | 名称 |
| --- | --- | --- |
| A | 1F | 正面エントランス |
| B | 1F | フードコート |
| C | 2F | 物販エリア |
| D | 2F | 倉庫・バックヤード（発報区域） |
| E | 3F | シネマ |
| F | B1F | 駐車場 |

- **警備員**：警備1 田中（隊長・防災センター）、警備2 佐藤（1F 巡回）、警備3 鈴木（B1F 巡回）
- **指示**：現場確認 / 初期消火 / 避難誘導 / 防災センターへ帰隊 / 待機
- **防災センター指令**：119番通報 / 非常放送（全館避難）
- **時間経過**：×1・×2・×4 の速度切替と一時停止。移動時間は階差で変化し、放置すると火勢が拡大して隣接区域へ煙が流入します
- **時系列ログ**：発報・指令・報告・危険・完了をすべて時刻付きで記録
- **評価**：鎮火または延焼拡大で状況終了となり、対応内容をスコアとランクで評価

## 画面構成

- MacBook（1180px 超）：モニター / 指示 / ログ の3カラム
- iPad：モニター・指示の2カラム + ログ
- iPhone（720px 以下）：下部タブで画面を切替

## 公開（GitHub Pages）

`main` へのマージ（push）で GitHub Actions（`.github/workflows/deploy-pages.yml`）がテスト → ビルド → GitHub Pages へのデプロイを自動実行します。プルリクエストではテストとビルドのみ実行し、公開はしません。

- 公開 URL：https://f48ksf5hgf-art.github.io/NS-SIM/
- 公開されるのは `dist/`（ビルド済みの HTML / JS / CSS / アイコン）のみです。ソースマップは出力しません。ゲーム内データはすべて架空のものです
- Vite の `base` は本番ビルド時に `/NS-SIM/`。ルートで配信するホスティングでは `BASE_PATH=/ npm run build` でビルドします

### 初回のみ必要な設定

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
2. **Actions** タブで「Deploy to GitHub Pages」を **Run workflow**（または `main` へ push）

> GitHub Free プランでは、非公開（private）リポジトリで GitHub Pages を使えません。リポジトリを公開（public）にするか、GitHub Pro 以上にするか、Cloudflare Pages などの代替ホスティングを使ってください。なお GitHub Pro でも、公開されたサイト自体は URL を知っていれば誰でも閲覧できます。

### iPad / iPhone のホーム画面に追加

Safari で公開 URL を開き、共有ボタン →「ホーム画面に追加」で、アプリのように全画面で起動できます。

## 開発

```bash
npm install
npm run dev      # 開発サーバー（--host を付けると同一ネットワークの iPad / iPhone から確認可能）
npm test         # Vitest によるテスト
npm run build    # 型チェック + 本番ビルド（dist/）
```

## ディレクトリ

```
src/
  game/          ゲームロジック（React 非依存の純粋関数）
    types.ts       型定義
    scenario.ts    シナリオ・施設・警備員の初期データ
    engine.ts      状態遷移（reducer）・時間進行・評価
    selectors.ts   表示用の状態変換
    useGame.ts     時間経過を管理する React フック
  components/    画面コンポーネント
  App.tsx        レイアウトと選択状態
  styles.css     ダークモード指令室デザイン
```
