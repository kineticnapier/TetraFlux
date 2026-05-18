# Garbage hole streaks

## 変更内容

`src/engine/tetris.ts` の `applyPendingGarbage()` を変更し、ゴミ穴が毎行完全ランダムにならないようにしました。

## 新しい挙動

```text
通常:
  同じ穴列を最低4行維持
  実際には4〜8行ぐらい続く

5%:
  1行だけランダムな穴列にする
  現在の連続穴列は維持
```

これで、ゴミ穴が散らばりすぎず、ある程度1列にまとまります。

## 変更ファイル

```text
src/engine/tetris.ts
README_GARBAGE_HOLE_STREAKS.md
```

## 注意

TETR.IO完全再現ではありません。  
Web trainer用に、読みやすく相殺しやすいgarbageへ寄せた近似です。
