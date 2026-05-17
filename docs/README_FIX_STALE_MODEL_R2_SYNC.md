# Fix stale deployed model with R2 model sync

## Problem

`Train policy from R2 logs` で新しい `web_policy.json` ができているのに、Webでは古いモデルが読み込まれる。

主原因はこれです。

```text
通常の Deploy to Cloudflare with Wrangler がpush時に走る
↓
repo内の古い public/models/web_policy.json を含むdistをdeployする
↓
train workflowでdeployした新モデルが上書きされる
```

## Fix

新しいモデルをR2に保存し、通常deployでもR2から最新モデルを取得してからbuildします。

```text
train-from-r2:
  export public/models/web_policy.json
  ↓
  R2へ upload
  key: models/latest/web_policy.json
  ↓
  build + deploy

deploy-cloudflare:
  build前にR2から models/latest/web_policy.json をdownload
  ↓
  public/models/web_policy.json に置く
  ↓
  build + deploy
```

これで通常deployが後から走っても、最新モデルを含んだdistになります。

## Changed files

```text
tools/sync_web_policy_r2.py
.github/workflows/train-from-r2.yml
.github/workflows/deploy-cloudflare.yml
.gitignore
README_FIX_STALE_MODEL_R2_SYNC.md
```

## Important: remove tracked stale model

もし `public/models/web_policy.json` がGit管理されている場合、gitignoreだけでは外れません。

一度これを実行してください。

```powershell
git rm --cached public/models/web_policy.json
```

ファイル自体をローカルから消したいなら:

```powershell
Remove-Item public/models/web_policy.json
```

その後:

```powershell
git add .
git commit -m "Sync latest web policy from R2 before deploy"
git push
```

## Optional variables

Repository variables:

```text
R2_MODEL_KEY = models/latest/web_policy.json
```

未設定ならこの値が使われます。

## Check

Cloudflare通常deployのログに:

```text
DEPLOY MODEL:
  model_id:
  exported_at:
```

が出ます。

ここが古ければR2側が古いです。  
ここが新しいのにWebが古ければブラウザキャッシュかCloudflare edge cacheです。
