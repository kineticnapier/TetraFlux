# FT15 default

## 原因

FT15になっていなかった理由は、`src/main.ts` の中で `firstTo` がまだ5固定だったためです。

```ts
firstTo = 5;
```

## 修正内容

```ts
firstTo = 15;
```

に変更しました。

Toolbarの表示も:

```html
New FT5
```

から:

```html
New FT15
```

に変更しました。

## 変更ファイル

```text
src/main.ts
index.html
README_FT15_DEFAULT.md
```

## 反映

```powershell
git add src/main.ts index.html README_FT15_DEFAULT.md
git commit -m "Use FT15 as default match length"
git push
```
