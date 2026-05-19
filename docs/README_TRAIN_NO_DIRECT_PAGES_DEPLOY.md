# Stop training workflow from directly deploying Pages

## 原因

`Train policy from R2 logs` が、学習後にそのまま `wrangler pages deploy dist` していました。

この方式だと、学習workflow側のcheckout状態・古いfrontend・Pages側の別deployと噛み合って、学習後に白画面のfrontendで上書きされることがあります。

## 修正方針

学習workflowは **モデルをR2へアップロードするだけ** にします。

その後、通常のCloudflare deploy workflowを呼び出します。

```text
Train policy from R2 logs
↓
web_policy.jsonをR2へupload
↓
deploy-cloudflare.ymlをtrigger
↓
通常deployがR2から最新modelをdownload
↓
npm run build
↓
distをPagesへdeploy
```

これで、frontend deploy経路を1つに統一できます。

## 変更点

```yaml
permissions:
  actions: write
```

を追加し、最後に:

```bash
gh workflow run deploy-cloudflare.yml \
  --ref "${GITHUB_REF_NAME}" \
  -f deploy_pages=true \
  -f deploy_worker=false
```

を実行します。

## 変更ファイル

```text
.github/workflows/train-from-r2.yml
README_TRAIN_NO_DIRECT_PAGES_DEPLOY.md
```

## 反映

```powershell
git add .github/workflows/train-from-r2.yml README_TRAIN_NO_DIRECT_PAGES_DEPLOY.md
git commit -m "Make training trigger normal Pages deploy"
git push
```

## 今すぐ白画面を戻す方法

Actionsから手動で:

```text
Deploy to Cloudflare with Wrangler
```

を実行してください。

```text
deploy_pages = true
deploy_worker = false
```

でOKです。
