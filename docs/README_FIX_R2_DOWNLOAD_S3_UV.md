# Fix R2 download: use S3 API + uv

## 原因

Wrangler 4.92.0 のログを見ると:

```text
wrangler r2 object
COMMANDS
  get
  put
  delete
```

になっていて、`r2 object list` が存在しません。

つまり前の:

```bash
npx wrangler r2 object list tetraflux-logs --prefix raw/ --json
```

は使えません。

## 修正方針

R2のS3互換APIでlist/downloadします。

```text
boto3
endpoint = https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com
list_objects_v2
download_file
```

## 追加で必要なSecrets

Repository Settings → Secrets and variables → Actions → Secrets

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

これは `CLOUDFLARE_API_TOKEN` とは別です。  
CloudflareのR2用Access Keyを作って入れてください。

既存:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

はそのまま使います。

## uv対応

学習workflowはpipではなくuvを使うように変更しました。

```yaml
- uses: astral-sh/setup-uv@v5
- run: uv python install 3.11
- run: uv pip install --python 3.11 -r requirements-training.txt
- run: uv run --python 3.11 python tools/...
```

## 変更ファイル

```text
requirements-training.txt
tools/download_r2_logs.py
.github/workflows/train-from-r2.yml
README_FIX_R2_DOWNLOAD_S3_UV.md
```

## 反映

```powershell
git add requirements-training.txt tools/download_r2_logs.py .github/workflows/train-from-r2.yml README_FIX_R2_DOWNLOAD_S3_UV.md
git commit -m "Use R2 S3 API and uv for training workflow"
git push
```

その後、GitHub Actionsで:

```text
Train policy from R2 logs
→ Run workflow
```

## 注意

もし `No .jsonl objects found` になった場合は、R2 bucket内のkeyが:

```text
raw/YYYY-MM-DD/web-ft5-0.2.0/...
```

になっているか確認してください。

prefixが違うなら、GitHub Variablesで:

```text
R2_LOG_PREFIX
```

を変更します。
