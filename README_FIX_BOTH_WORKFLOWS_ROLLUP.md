# Fix both GitHub Actions workflows: Rollup optional dependency

## 症状

```text
Cannot find module @rollup/rollup-linux-x64-gnu
npm has a bug related to optional dependencies
```

Cloudflare workflowだけでなく、GitHub Pages workflowも `npm run build` 前のinstallで同じ問題を踏みます。

## 今回の修正

以下2つを置き換えます。

```text
.github/workflows/deploy-cloudflare.yml
.github/workflows/github-pages.yml
```

両方で:

```bash
rm -rf node_modules package-lock.json
npm install --include=optional --no-audit --no-fund
node -e "require('@rollup/rollup-linux-x64-gnu')"
```

を実行するようにしました。

これにより、GitHub ActionsのLinux runner上でRollupのLinux native optional packageを再解決します。

## 注意

これはCI側の応急処置です。

よりきれいな恒久対応は、ローカルでlockfileを作り直してcommitすることです。

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
git add package-lock.json
git commit -m "Regenerate npm lockfile"
git push
```

ただし、Windowsで作ったlockfileがまたLinux optional dependencyを欠く場合があります。  
その場合は、このworkflow側の回避策を残す方が安定します。
