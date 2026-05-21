# Fix Garbage Lab build errors

## 原因

`render()` 側から次のメソッドを呼んでいましたが、`Ft5Trainer` class内で `private` になっていました。

```ts
labQueuedGarbage()
labReadyGarbage(now)
nextLabGarbageSeconds(now)
```

TypeScriptではclass外から `private` methodを呼べないため、buildが失敗していました。

## 修正

表示用に必要なgetter扱いなので、`private` を外しました。

```ts
labQueuedGarbage(): number
labReadyGarbage(now: number): number
nextLabGarbageSeconds(now: number): string
```

## 変更ファイル

```text
src/main.ts
README_FIX_GARBAGE_LAB_BUILD.md
```

## 反映

```powershell
git add src/main.ts README_FIX_GARBAGE_LAB_BUILD.md
git commit -m "Fix Garbage Lab public render methods"
git push
```
