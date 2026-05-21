# Fix mod build errors

## 原因

### 1. toolbar used before declaration

`quickPlayModSelect` を作る処理が、`toolbar` の宣言より前に置かれていました。

```text
Block-scoped variable 'toolbar' used before its declaration
```

修正後は、`toolbar` を取得した後で `select` を生成します。

### 2. revealInvisible の変数名ミス

実際に宣言している変数は:

```ts
const invisibleReveal = ...
```

なのに、オブジェクトには shorthand で:

```ts
revealInvisible,
```

を書いていました。

修正後:

```ts
revealInvisible: invisibleReveal,
```

## 変更ファイル

```text
src/main.ts
README_FIX_MOD_BUILD_ERRORS.md
```

## 反映

```powershell
git add src/main.ts README_FIX_MOD_BUILD_ERRORS.md
git commit -m "Fix Quick Play mod build errors"
git push
```
