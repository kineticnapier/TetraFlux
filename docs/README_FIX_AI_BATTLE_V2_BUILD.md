# Fix AI Battle self-training v2 build errors

## 原因

### 1. selfTrainingMatches の残骸

Self Training modeを削除した後も、古い自動ループ処理が残っていました。

```ts
this.selfTrainingMatches++;
```

現在のフィールドは:

```ts
this.aiBattleCompletedMatches++;
```

なので、古いブロックを削除しました。

### 2. 不可能なmode比較

self_train削除時の置換で、次のような条件が残っていました。

```ts
this.mode !== "ai_vs_ai" && this.mode !== "ai_vs_ai"
```

TypeScriptが「この比較は意味がない」と判断してbuildが落ちていました。

修正後:

```ts
this.mode !== "ai_vs_ai"
```

`trainer.mode` 側も同様に修正しました。

## 変更ファイル

```text
src/main.ts
README_FIX_AI_BATTLE_V2_BUILD.md
```

## 反映

```powershell
git add src/main.ts README_FIX_AI_BATTLE_V2_BUILD.md
git commit -m "Fix AI Battle self-training build errors"
git push
```
