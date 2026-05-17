# Step 3: Upload Logs → Worker → R2

ここでは、Web trainerの `Upload Logs` ボタンからJSONLをCloudflare R2へ保存できるようにします。

## 追加/変更ファイル

```text
worker/package.json
worker/tsconfig.json
worker/wrangler.toml
worker/src/index.ts
.github/workflows/deploy-cloudflare.yml
README_STEP3_WORKER_R2_UPLOAD.md
```

## 構成

```text
Cloudflare Pages
  Web FT5 Trainer

Upload Logs
  ↓ POST application/x-ndjson

Cloudflare Worker
  schema validation
  duplicate check
  ↓

Cloudflare R2
  raw/YYYY-MM-DD/web-ft5-0.2.0/<match_id>_<hash>.jsonl
```

## 1. R2 bucketを作る

ローカルで一度だけ:

```powershell
npx wrangler@latest login
npx wrangler@latest r2 bucket create tetraflux-logs
```

## 2. Workerをローカルdeploy

```powershell
cd worker
npm install
npx wrangler@latest deploy
cd ..
```

deploy後にWorker URLを確認してください。

例:

```text
https://tetraflux-log-upload.<your-subdomain>.workers.dev
```

## 3. GitHub Repository variablesを追加

Repository Settings → Secrets and variables → Actions → Variables

```text
CF_PAGES_PROJECT_NAME
VITE_LOG_UPLOAD_URL
```

例:

```text
CF_PAGES_PROJECT_NAME = tetraflux
VITE_LOG_UPLOAD_URL = https://tetraflux-log-upload.<your-subdomain>.workers.dev
```

任意:

```text
CLOUDFLARE_WORKERS_SUBDOMAIN
```

これはworkflow内の表示用です。`VITE_LOG_UPLOAD_URL` を明示していれば必須ではありません。

## 4. GitHub Repository secretsを追加

Repository Settings → Secrets and variables → Actions → Secrets

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

API Tokenは最低限:

```text
Cloudflare Pages: Edit
Workers Scripts: Edit
Workers R2 Storage: Edit
Account Settings: Read
```

あたりが必要です。

## 5. GitHub Actionsでdeploy

mainにpush:

```powershell
git add .
git commit -m "Add Worker R2 log upload"
git push
```

またはActionsから手動実行:

```text
Deploy to Cloudflare with Wrangler
→ Run workflow
```

## 6. Webで確認

1. PagesのURLを開く
2. 1試合プレイ
3. `Upload Logs` を押す
4. Statusに `{"ok":true,...}` が出る
5. Cloudflare R2の `tetraflux-logs` bucketを見る

保存先:

```text
raw/YYYY-MM-DD/web-ft5-0.2.0/<match_id>_<hash>.jsonl
```

## 注意

`VITE_LOG_UPLOAD_URL` はViteのbuild時に埋め込まれます。

つまり、GitHub Variablesで `VITE_LOG_UPLOAD_URL` を設定したら、Pagesを再build/redeployしてください。

## 手動回収との関係

Download Logsは残します。

```text
Upload Logs:
  自動収集

Download Logs:
  保険・手動回収用
```

両方あってOKです。
