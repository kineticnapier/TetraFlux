# Spin plan targets and Volatile Garbage fix

## 変更内容

### 1. Spinを「探索で偶然発見」ではなく「計画」として評価

盤面からT-slot系の形を先にスキャンします。

```text
Spin形を先に決める
↓
requiredCells / forbiddenCells / slotCells を作る
↓
候補手がそこにどう影響したかだけを見る
```

追加した概念:

```ts
interface SpinPlanTarget {
  kind: "TSD" | "TST" | "STSD" | "TSlot";
  requiredCells: GridCell[];
  forbiddenCells: GridCell[];
  slotCells: GridCell[];
}
```

### 2. 評価

```text
Spin完成       : +10000
あと1手相当    : +3000
あと2手相当    : +1000
slot破壊       : -5000
requiredを埋めた: +650 / cell
```

### 3. 探索量は増やしていない

次ミノ探索やBFSを増やしていません。  
盤面スキャンとセル差分だけで評価します。

### 4. Volatile Garbageの28ライン問題を修正

原因は、攻撃側で `attackMultiplier` を掛けたあと、受け取り側でさらに `incomingMultiplier` を掛けていたことです。

```text
Quad 4
× attack 2
× incoming 2
= 16以上、combo/B2B次第で28
```

修正後:

```text
攻撃として送るgarbage:
  attackMultiplierだけ適用

Garbage Labなど外部発生garbage:
  incomingMultiplierを適用
```

つまり、対戦攻撃では二重乗算しません。

## build

`npm run build` で確認済みです。

## 変更ファイル

```text
src/main.ts
README_SPIN_PLAN_TARGETS_VOLATILE_FIX.md
```
