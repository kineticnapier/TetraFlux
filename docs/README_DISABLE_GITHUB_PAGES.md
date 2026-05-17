# Disable GitHub Pages workflow

Cloudflare Pagesを使うので、GitHub Pages workflowは不要です。

この変更では:

```text
.github/workflows/github-pages.yml
```

をno-op workflowに置き換えています。

## 理由

GitHub Pagesが有効化されていないrepoで:

```yaml
actions/configure-pages@v5
```

を実行すると:

```text
Get Pages site failed
Not Found
```

になります。

## 反映

```powershell
git add .github/workflows/github-pages.yml
git commit -m "Disable GitHub Pages workflow"
git push
```

既に失敗した過去のworkflow runは消えませんが、次回push以降はGitHub Pages deployが自動実行されません。

Cloudflare側は引き続き:

```text
.github/workflows/deploy-cloudflare.yml
```

で動きます。
