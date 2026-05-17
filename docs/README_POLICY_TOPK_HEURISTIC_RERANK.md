# Policy top-k + heuristic rerank

## 変更内容

WebPolicyAIを、学習policy単体選択からハイブリッド選択に変えました。

```text
Before:
  policyのlogitが一番高い合法手を選ぶ

After:
  1. policyで合法手を順位付け
  2. 上位 top80 を取り出す
  3. HeuristicAI.scoreAfter() で盤面評価
  4. heuristic score + 小さいpolicy rank penalty で最終選択
```

## 目的

今のモデルはbehavior cloningなので、AI自身が崩して人間ログに少ない局面へ入ると弱いです。

そのため:

```text
policy:
  人間っぽい候補を絞る

heuristic:
  穴・高さ・bumpiness・attackなどで生存寄りにrerank
```

という役割にします。

## 表示

AI欄に:

```text
mode: policy top-k + heuristic rerank
rerank: top80, rankPenalty=0.08
learned ops: ...
dataset ops: ...
```

が出ます。

## 調整したい場合

`src/ai/webPolicy.ts` の上部:

```ts
const POLICY_TOP_K = 80;
const POLICY_RANK_PENALTY = 0.08;
const POLICY_LOGIT_GAP_PENALTY = 0.02;
```

を変えます。

```text
もっと強くしたい:
  POLICY_TOP_K を増やす
  POLICY_RANK_PENALTY を下げる

もっと人間ログ寄りにしたい:
  POLICY_TOP_K を減らす
  POLICY_RANK_PENALTY を上げる
```

今のモデルが弱いなら、まずは `top80` 以上が無難です。
