# AI hard-drop fast path and anti-freeze rerank

## 変更内容

### 1. hard dropだけで行ける場所はhard dropのみ

AIの目的地が現在位置からそのまま真下にある場合、移動経路を探索せずに即 `harddrop` 扱いにします。

```text
current x/rot
↓
target x/rot が同じ
↓
hardDropDistance が目的地と一致
↓
ops = []
```

これで、見た目上も余計な `soft` や横移動が入りません。

### 2. rotate/moveだけの高速経路を先に試す

BFS前に以下を試します。

```text
rotate -> horizontal -> harddrop
horizontal -> rotate -> harddrop
```

普通の置き方はほぼこれで終わるため、BFSに入る回数を減らします。

### 3. BFSを強く制限

BFSはspinや特殊到達用の最後の手段にしました。

制限:

```text
maxPath = 28
maxStates = 140
maxMs = 1.8ms
```

### 4. rerankの探索量を削減

候補全部にBFSをかけるのをやめました。

```text
評価候補:
  最大18件

route search:
  通常時 最大6件
  危険時 最大3件

rerank budget:
  通常時 4.5ms
  危険時 2.0ms
```

route searchしない候補は `applyAction()` の軽い仮置きだけでstatic setupを見ます。

## build

`npm run build` で確認済みです。

## 変更ファイル

```text
src/main.ts
README_AI_HARDDROP_FASTPATH_NO_FREEZE.md
```
