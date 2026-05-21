# AI spin setup lookahead

## 変更内容

前回の `soft drop BFS + spin-aware rerank` の次の工程として、**次ミノspin setup評価** を追加しました。

### 1. engineAfterを保持

AIの仮実行結果に、lock後のengine状態を持たせました。

```ts
interface AiMoveExecution {
  result: LockResult;
  ops: AiMoveOp[];
  reachedTarget: boolean;
  engineAfter: TetrisEngine;
}
```

これにより、

```text
今の候補手
↓
仮置き
↓
次ミノの候補を調べる
```

ができます。

### 2. 次ミノspin opportunityを評価

現在の候補手を仮置きしたあと、次のactive pieceでspinできる候補があるか調べます。

```text
current candidate
↓
engineAfter
↓
next legal placements上位14件
↓
soft-drop BFS付きで仮実行
↓
LockResult.spin !== "none" ならsetup bonus
```

### 3. immediate spinとsetup spinを分離

即spinは強めに評価します。

```text
immediate spin:
  full bonus
```

次ミノspin setupは不確定なので、少し弱めに評価します。

```text
next spin setup:
  spinBonus * 0.55
```

### 4. 危険時はsetup greedを無効化

盤面が高い、またはincomingが多いときは、setup狙いを止めます。

```text
maxHeight >= 14
pendingGarbage >= 6
```

## build

`npm run build` で確認済みです。

## 変更ファイル

```text
src/main.ts
README_AI_SPIN_LOOKAHEAD.md
```
