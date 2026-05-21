# AI move-to-place execution

## 変更内容

AIが `applyAction()` で指定位置へ直接ワープ配置するのをやめました。

旧:

```text
AI choose:
  x / rot / hold を決める
↓
engine.applyAction(action)
↓
active.x = action.x
active.rot = action.rot
↓
hardDrop
```

新:

```text
AI choose:
  x / rot / hold を決める
↓
hold / rotate / left / right の操作列をBFSで探索
↓
実際に engine.holdPiece()
       engine.rotateCw()
       engine.move(...)
       engine.hardDrop()
を呼ぶ
```

## 目的

「指定した場所に置く」ではなく、

```text
指定した場所まで動かして置く
```

にします。

これにより:

```text
・AIの挙動が人間寄りになる
・移動不能な配置はroute_failedになる
・直接配置による不自然な挙動が減る
・回転操作を通るので、通常のspin判定に近づく
```

## 実装

追加:

```ts
type AiMoveOp = "hold" | "left" | "right" | "cw" | "ccw" | "180";

private findAiMovePath(...)
private executeAiPlacementByMoves(...)
private applyAiMoveOp(...)
```

AIの実行部分は:

```ts
const execution = this.executeAiPlacementByMoves(engine, plannedAction);
const result = this.applyQuickPlayModToResult(execution.result, action);
```

に変更しました。

## ログ

`action.key` に移動列を入れます。

例:

```text
T:4:1|moves:cw,right,right
H:I:2:0|moves:hold,left,left
T:-2:3|moves:harddrop|route_failed
```

`route_failed` は、指定された最終位置に通常操作で到達できなかった場合です。  
その場合はワープせず、現在位置からhard dropします。

## 注意

今の段階ではsoft dropを絡めた高度なspin setupまでは探索していません。

探索対象:

```text
hold
left / right
cw / ccw / 180
hardDrop
```

次に必要なら、soft dropや「回転後に数段落としてから再回転」も探索に入れられます。

## 変更ファイル

```text
src/main.ts
README_AI_MOVE_TO_PLACE_EXECUTION.md
```

## 反映

```powershell
git add src/main.ts README_AI_MOVE_TO_PLACE_EXECUTION.md
git commit -m "Execute AI placements through movement"
git push
```
