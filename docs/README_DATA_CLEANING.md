# TetraFlux Web log cleaning

AIの盤面が穴だらけになる場合、まず学習データ汚染を疑います。

主な原因:

```text
古いtrainer versionのログが混ざっている
負けroundが混ざっている
操作バグ修正前のログが混ざっている
穴だらけでも勝ったroundが混ざっている
テストプレイの雑なログが混ざっている
```

## 1. 監査

```powershell
python .\tools\audit_web_logs.py `
  --input .\data\merged_web_logs.jsonl `
  --out .\data\audit_web_logs.json
```

見るところ:

```text
versions
round_winners
metrics.avg_holes
metrics.max_holes
metrics.hole_buckets
dirty_examples
top_actions
```

## 2. フィルタ

まずはかなり厳しめ:

```powershell
python .\tools\filter_web_logs.py `
  --input .\data\merged_web_logs.jsonl `
  --out .\data\merged_web_logs_clean.jsonl `
  --trainer-version web-ft5-0.2.0 `
  --winner human `
  --max-holes 20 `
  --max-height 18 `
  --max-pending-garbage 8 `
  --min-round-length 8
```

## 3. dataset化

```powershell
python .\tools\build_web_dataset.py `
  --input .\data\merged_web_logs_clean.jsonl `
  --out .\data\web_human_dataset_clean.jsonl
```

## 4. 再学習

```powershell
python .\tools\train_web_policy.py `
  --data .\data\web_human_dataset_clean.jsonl `
  --out-dir .\models\web_human_policy_clean `
  --epochs 50 `
  --batch-size 256 `
  --device auto
```

## 5. JSON export

```powershell
python .\tools\export_web_policy_json.py `
  --checkpoint .\models\web_human_policy_clean\best_policy.pt `
  --out .\public\models\web_policy.json
```

## 注意

clean後の行数が少なすぎる場合は、無理に学習しない方がいいです。

```text
目安:
  数百行以下  → ほぼ足りない
  1000行台   → 動くが怪しい
  5000行以上 → かなりマシ
```

ログが少ない場合は、修正済みのWeb trainerで新しく取り直してください。
