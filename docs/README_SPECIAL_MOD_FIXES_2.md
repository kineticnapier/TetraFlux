# Special mod fixes

## 変更内容

### Loaded Dice

開始盤面のdice patternを横2×縦3に修正しました。

```text
旧:
  横2 × 縦4

新:
  横2 × 縦3
```

### Freefall

`instantGround` を本当に即接地にしました。

```text
spawn / update / AI action
↓
active.y += hardDropDistance(active)
```

HumanだけでなくAI側にも適用します。

### Last Stand

描画上の危険エリア表示ではなく、実際に盤面表示を6段縮めました。

```text
通常:
  20 visible rows

Last Stand:
  14 visible rows
```

システム側は従来通り `maxHeight > 14` でtopoutします。

また、攻撃は素のまま、受け取り時だけ3倍になるようにしました。

```text
attack:
  normal

cancel:
  normal

receive:
  x3
```

### Damnation

開始盤面を縦10段の市松模様に修正しました。

```text
top 10 rows:
  empty

bottom 10 rows:
  checkerboard pattern
```

## build

`npm run build` で確認済みです。

## 変更ファイル

```text
src/main.ts
src/render.ts
README_SPECIAL_MOD_FIXES_2.md
```
