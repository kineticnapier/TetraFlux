# Delayed garbage indicator for all battle modes

## 変更内容

### 1. 赤readyが下から出るように変更

G indicatorは下から順に描画します。  
`ready` を先に渡すことで、赤いready garbageが下から伸びるようにしました。

```text
bottom:
  red ready

above:
  gray scheduled
```

### 2. Human vs AI / AI Battleにも適用

Garbage Labだけでなく、Human vs AIとAI Battleでも同じ流れにしました。

```text
攻撃を受ける
↓
gray scheduled
↓
一定時間後 red ready
↓
lock時に盤面へ放出
```

### 3. Zenith TowerをMode切り替えから削除

Mode cycleは以下の3つです。

```text
Human vs AI
AI Battle
Garbage Lab
```

### 4. AIに少しランダム性を追加

危険でない盤面では約10%で2番手付近の手を選びます。

ランダム性を切る条件:

```text
maxHeight >= 14
pendingGarbage >= 6
```

## build

`npm run build` で確認済みです。

## 変更ファイル

```text
src/main.ts
src/render.ts
README_DELAYED_GARBAGE_ALL_MODES_NO_ZENITH.md
```
