# TetraFlux Web FT5 Trainer

TetraFlux用のWeb Human-in-the-loop trainerです。

## v0.2.0 の変更

```text
Next表示を大きくした
hold表示を追加
左右長押し移動をDAS/ARRで実装
SRS 90° kickを実装
SRS-like 180° kickを実装
T-spin / mini検出を追加
B2B / combo / cancel-ish garbageを追加
AIを非同期化し、mino/sを指定可能にした
```

注意:

```text
TETR.IOには一切接続しません。
これは自作Canvas環境です。
TETR.IO完全再現ではなく、TETR.IO寄せのtrainerです。
```

## 起動

```powershell
npm install
npm run dev
```

## 操作

```text
Left / Right 長押し:
  DAS/ARR移動

Down 長押し:
  soft drop

Z:
  左回転

X / Up:
  右回転

A:
  180°

C / Shift:
  hold

Space:
  hard drop

Enter:
  round終了後、次round

R:
  match reset
```

## 設定

画面下で変更できます。

```text
AI mino/s:
  AIの配置速度

DAS ms:
  横移動開始までの遅延

ARR ms:
  横移動の連続間隔
  0にするとDAS後に壁まで一気に移動
```

## GitHub Pages

```powershell
npm run build
```

GitHub側でPages sourceをGitHub Actionsにして、mainへpushしてください。

## ログ

`Download Logs` でJSONLを保存できます。

まとめる場合:

```powershell
python .	ools\merge_jsonl.py `
  --input .\collected_logs `
  --out .\data\merged_web_logs.jsonl
```

## Cloudflare Worker

`worker/` にR2保存用Workerの雛形があります。

```powershell
cd worker
npm install
copy wrangler.toml.example wrangler.toml
npm run deploy
```

Web側 `.env`:

```text
VITE_LOG_UPLOAD_URL=https://<your-worker>.workers.dev/
```

## まだ完全ではないところ

```text
TETR.IO完全なSRS+ではない
TETR.IO完全な火力表ではない
T-spin mini判定は簡易
all-spinはログ用の簡易検出
PPS/重力/lock delayは未実装
```

ただし、前版より「TETR.IOっぽく練習・ログ収集する」方向には寄せています。
