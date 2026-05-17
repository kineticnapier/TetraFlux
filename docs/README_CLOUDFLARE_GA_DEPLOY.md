# GitHub Actions + Wrangler deploy

この構成では、GitHub ActionsからWranglerを直接実行してCloudflareへdeployします。

## 追加ファイル

```text
.github/workflows/deploy-cloudflare.yml
```

## 使い分け

```text
フロントエンド:
  npx wrangler pages deploy dist

Worker:
  cd worker
  npx wrangler deploy
```

`wrangler deploy` はWorker用です。  
Cloudflare Pagesへ静的サイトを上げる場合は `wrangler pages deploy` を使います。

## GitHub側に設定するもの

Repository Settings → Secrets and variables → Actions

### Secrets

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

### Variables

```text
CF_PAGES_PROJECT_NAME
```

例:

```text
CF_PAGES_PROJECT_NAME = tetraflux
```

## Cloudflare API Tokenに必要な権限

Pagesだけなら、最低限はPagesを編集できる権限を付けてください。

Workerもdeployするなら、Workers Scriptsも編集できる権限が必要です。

## 重要: Vite base

このrepoの `vite.config.ts` は、GitHub Actions上だとGitHub Pages用に `/${repo}/` をbaseにする処理があります。

Cloudflare Pagesでは通常 `/` で配信したいので、workflow内で:

```yaml
VITE_BASE: /
```

を強制しています。

これを外すと、Cloudflare Pages上でJS/CSSのパスが `/TetraFlux/...` になって壊れる可能性があります。

## deploy

mainへpush:

```powershell
git add .
git commit -m "Add Cloudflare Wrangler deploy workflow"
git push
```

またはGitHubのActions画面から:

```text
Deploy to Cloudflare with Wrangler
→ Run workflow
```

## Worker deployについて

`deploy_worker` は手動実行時だけONにできます。

```text
workflow_dispatch
  deploy_worker = true
```

`worker/wrangler.toml` が存在しない場合は自動でskipします。

## 既存のGitHub Pages workflowとの関係

GitHub Pagesへもdeployするなら、既存のPages workflowを残してOKです。

Cloudflareだけにするなら、GitHub Pages側のworkflowは無効化または削除してもOKです。
