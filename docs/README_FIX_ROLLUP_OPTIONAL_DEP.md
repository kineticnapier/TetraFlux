# Fix Rollup optional dependency error on GitHub Actions

GitHub Actionsで以下のようなエラーが出る場合:

```text
Cannot find module @rollup/rollup-linux-x64-gnu
npm has a bug related to optional dependencies
```

原因は、`package-lock.json` がWindows環境寄りになっていて、Linux runnerで必要なRollup optional dependencyが復元されないことです。

## 今回の修正

workflow内の依存関係installを:

```bash
npm ci
```

から:

```bash
npm install --include=optional
```

に変更しました。

これでGitHub ActionsのLinux環境で `@rollup/rollup-linux-x64-gnu` が入ります。

## よりきれいな恒久対応

ローカルでも一度lockを作り直すと安定します。

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
git add package-lock.json
git commit -m "Regenerate npm lockfile"
git push
```

ただし、まずはworkflow修正だけで動くはずです。
