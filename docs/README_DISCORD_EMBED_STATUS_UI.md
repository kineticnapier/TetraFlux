# Discord embed / icon / status panel cleanup

## 変更内容

### Discord用OGP

`index.html` にDiscord等の埋め込み用metaを追加しました。

```html
<meta property="og:title" content="TetraFlux Web FT5 Trainer" />
<meta property="og:description" content="Play FT5 Tetris matches, upload logs, and train a human-in-the-loop AI." />
<meta property="og:image" content="https://tetraflux.pages.dev/tetraflux-og.svg" />
```

Production URLが `https://tetraflux.pages.dev/` ではない場合は、`index.html` のURLを実際のPages URLに置き換えてください。

注意:
DiscordでSVGのOG画像が表示されない場合があります。その場合は同じデザインをPNG化して `og:image` をPNGへ変更してください。

### アイコン追加

```text
public/favicon.svg
public/tetraflux-icon.svg
public/tetraflux-og.svg
```

### Status panel調整

```text
status panelのY座標を盤面上端に合わせた
下端近くまで伸ばすようにした
Online欄を削除
playing n は上部の緑表示とtoolbar badgeに統合
AI情報を最大6行までに削減
```

### AI情報削減

`src/ai/webPolicy.ts` の `infoLines()` を短くしました。

表示例:

```text
model: ga_r2_clean...
export: 2026-...
mode: policy top80 + heuristic
ops: 123,456 train
dataset: 150,000 total
test: t1 20.0% / t5 60.0%
```

## 変更ファイル

```text
index.html
src/main.ts
src/ai/webPolicy.ts
public/favicon.svg
public/tetraflux-icon.svg
public/tetraflux-og.svg
README_DISCORD_EMBED_STATUS_UI.md
```
