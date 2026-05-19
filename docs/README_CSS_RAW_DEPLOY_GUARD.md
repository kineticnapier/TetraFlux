# CSS/raw deploy guard

## 状況

スクショの状態は、CSSだけではなく、Viteのbuild済みbundleが読まれていない時の見た目です。

```text
- canvasが白い
- toolbarがブラウザ標準button
- Settings modalが常時表示
- playing: ? のまま
```

これは `dist/` ではなく、repository root の `index.html` がそのまま配信されている時に起きます。

正しいCloudflare Pages deployでは、`dist/index.html` に以下のようなhashed assetが入ります。

```html
<script type="module" crossorigin src="/assets/index-xxxx.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-xxxx.css">
```

## 変更内容

### 1. raw-source fallback CSS

`index.html` に以下を追加しました。

```html
<link rel="stylesheet" href="/src/style.css" />
```

これは、誤ってrepository rootが配信された時の保険です。

### 2. Settings modalのhidden属性

CSSが壊れてもmodalが最初から出っぱなしにならないようにしました。

```html
<div id="settingsModal" class="modal hidden" hidden aria-hidden="true">
```

`src/main.ts` 側でも `settingsModal.hidden` をopen/close時に切り替えます。

### 3. Pages cache header

`public/_headers` を追加し、HTMLのキャッシュを抑えます。

## 重要

根本対策はCloudflare Pagesが必ず `dist/` を配信することです。

Cloudflare Pages側でGit連携の自動deployを使っている場合は、設定を確認してください。

```text
Build command:
  npm run build

Build output directory:
  dist
```

Wrangler workflowだけでdeployする場合は、Pages側の別deployが上書きしていないか確認してください。

## 変更ファイル

```text
index.html
src/main.ts
public/_headers
README_CSS_RAW_DEPLOY_GUARD.md
```
