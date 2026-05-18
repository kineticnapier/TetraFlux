# All-piece spins + AI ghost

## 変更内容

### 全ミノのspin検出

`src/engine/tetris.ts` のspin検出を拡張しました。

```text
T:
  既存のT-spin / T-spin miniを維持

I/J/L/O/S/Z:
  rotation後の最終位置が left / right / down に動けない場合、
  generic spin として検出
```

これはTETR.IO完全再現ではなく、Web sandbox用の近似all-spinです。

### generic spin火力

```text
spin single: 1
spin double: 2
spin triple: 4
spin quad:   6
```

B2B対象にも入ります。

### AI placementでもspin評価

AIはkey-by-key操作ではなく、最終配置 `(piece, x, rot, hold)` を直接置きます。
そのままだと「回転で入れた」という情報が無くspin判定されないため、`applyAction()` ではplacementをrotation-derivedとして扱います。

これにより、AIがspinになる最終配置を選ぶと `result.spin = spin / tspin` になります。

### AIにもghost表示

`src/render.ts` を変更し、Human / AI / AI Battleの全盤面でghostを表示します。

## AIにspinを学習させられるか

できます。ただし現状では **入力手順としてのspin** ではなく、**spinになる最終配置** を学習します。

今の教師データは基本的に:

```text
盤面状態 + active + hold + next
↓
最終配置 piece:x:rot
```

なので、AIは「この局面ではこの最終配置を選ぶとspinになる」という形で学習します。

本当に操作列としてのspinを学習させるには、追加で:

```text
rotation path
kick index
input sequence
lock前の操作履歴
spin kind
```

をログに入れる必要があります。

## 変更ファイル

```text
src/engine/tetris.ts
src/render.ts
README_ALL_PIECE_SPINS_AI_GHOST.md
```
