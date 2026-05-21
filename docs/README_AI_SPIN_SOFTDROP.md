# AI spin support: soft-drop BFS and spin-aware rerank

## 変更内容

### 1. AI移動探索にsoft dropを追加

AIの移動操作に `soft` を追加しました。

```ts
type AiMoveOp =
  | "hold"
  | "left"
  | "right"
  | "cw"
  | "ccw"
  | "180"
  | "soft";
```

これで、AIは以下のような経路を取れます。

```text
left
soft
soft
cw
harddrop
```

### 2. BFSのtargetにy座標を追加

旧:

```text
target = x + rot
```

新:

```text
target = x + y + rot
```

最終着地点付近まで落としてから回転する経路を探索できます。

### 3. 回転で終わる経路を優先

同じ最終位置に到達できる場合、

```text
horizontal + soft
```

より、

```text
soft + rotate
```

を優先します。

これによりT-spin / All-spinのような「最後の操作が回転」の配置が出やすくなります。

### 4. spin-aware rerankを追加

AI候補手を評価するとき、実際の移動経路で仮実行し、`LockResult.spin` が出た手にbonusを付けます。

```text
spinあり:
  scoreを下げる
  attackSentが大きいほどさらに優遇
  T-spinは追加優遇
  All-Spin中はnon-T spinも少し優遇
```

### 5. ランダム性は維持

危険でない盤面では、約10%で2番手付近を選びます。  
ただしspin-aware補正後の順位から選びます。

## build

`npm run build` で確認済みです。

## 変更ファイル

```text
src/main.ts
README_AI_SPIN_SOFTDROP.md
```
