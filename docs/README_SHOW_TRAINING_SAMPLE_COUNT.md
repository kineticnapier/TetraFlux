# Show training sample count in AI panel

## 変更内容

AI欄に、モデルがどれだけの操作を学習したかを表示します。

表示例:

```text
learned ops: 12,345 train
dataset ops: 15,432 total (tr 12,345 / va 1,543 / te 1,544)
best epoch: 18
test: top1 23.4% / top5 61.2% / softX1 70.1%
acc: piece 85.0% / x 40.0%
```

## 仕組み

`tools/export_web_policy_json.py` が `summary.json` を `training_summary` として `web_policy.json` に埋め込んでいる前提です。

`summary.json` の主な値:

```text
train_n
val_n
test_n
best_epoch
test.top1
test.top5
test.soft_x1
test.piece_acc
test.x_acc
```

## 変更ファイル

```text
src/ai/webPolicy.ts
src/main.ts
```

## 弱い理由メモ

今のWebPolicyAIは基本的にbehavior cloningです。  
つまり「その局面で人間が置いた手」を教師あり学習しているだけなので、AI自身が少しミスって人間ログに無い局面へ外れると、そこから崩れやすいです。

対策候補:

```text
1. もっと大量のログを集める
2. 負けroundや汚いroundをさらに強く除外する
3. HeuristicAIの評価値とPolicyを混ぜる
4. policy top-kからheuristic/valueでrerankする
5. AIが崩れた局面に対して人間が修正手を入れるDAgger寄りにする
```
