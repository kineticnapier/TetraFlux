# Fix Vite base for Cloudflare Pages

## 原因

白画面の原因は、build後のasset URLがCloudflare Pages用ではなくGitHub Pages用になっていることです。

エラー:

```text
https://tetraflux.pages.dev/TetraFlux/assets/index-xxxx.css
https://tetraflux.pages.dev/TetraFlux/assets/index-xxxx.js
```

Cloudflare Pagesでは `/TetraFlux/` ではなく、通常はroot直下です。

正しいasset URL:

```text
https://tetraflux.pages.dev/assets/index-xxxx.css
https://tetraflux.pages.dev/assets/index-xxxx.js
```

つまり、Viteの `base` が `/TetraFlux/` になっています。

## 修正内容

`vite.config.ts` をCloudflare Pages向けに固定しました。

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  server: { port: 5173 }
});
```

以前の `githubPagesBase()` は削除しました。

## 反映

```powershell
git add vite.config.ts README_FIX_VITE_BASE_CLOUDFLARE.md
git commit -m "Fix Vite base for Cloudflare Pages"
git push
```

その後、Actionsから通常deployを実行してください。

```text
Deploy to Cloudflare with Wrangler
deploy_pages = true
deploy_worker = false
```

## まだ直らない場合

Cloudflare PagesのGit連携deployが別に動いている場合、Pages側の環境変数にも入れてください。

```text
VITE_BASE=/
```

または、Cloudflare PagesのGit連携deployを止めて、GitHub ActionsのWrangler deployだけに統一してください。

## 確認方法

deploy後、ブラウザでページのHTMLを見て、asset URLがこうなっていればOKです。

```html
<script type="module" crossorigin src="/assets/index-xxxx.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-xxxx.css">
```

こうなっていたらまだNGです。

```html
<script type="module" crossorigin src="/TetraFlux/assets/index-xxxx.js"></script>
<link rel="stylesheet" crossorigin href="/TetraFlux/assets/index-xxxx.css">
```
