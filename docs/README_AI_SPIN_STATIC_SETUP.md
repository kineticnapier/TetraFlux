# AI spin setup without expensive search

## 変更内容

前回の次ミノlookaheadは、各候補に対してさらに `legalPlacements()` とBFSを回すため、候補数が多い場面で固まりやすくなっていました。

今回はその方式をやめて、**静的な盤面スキャン** に置き換えました。

## 新方式

```text
候補手を仮置き
↓
lock後のboardだけを見る
↓
T-slotっぽい形をO(10×20×4)でスキャン
↓
setup bonus
```

探索しません。

使わないもの:

```text
次ミノ legalPlacements()
次ミノ BFS
次ミノ 仮lock
```

## 見る形

主にT-slotを見ます。

```text
・Tの中心が空いている
・Tの4隅のうち3つ以上が埋まっている
・Tの形が入る空間がある
・下側の支えがあるほど少し加点
```

All-Spin中だけ、弱めにgeneric cavityも見ます。

## 効果

```text
・フリーズしにくい
・spin済みの手は今まで通り優遇
・次にspinできそうな形を軽く優遇
・危険時はsetup bonusを切る
```

## build

`npm run build` で確認済みです。

## 変更ファイル

```text
src/main.ts
README_AI_SPIN_STATIC_SETUP.md
```
