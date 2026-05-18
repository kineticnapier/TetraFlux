# Self-play logs for AI Battle

AI Battleのログを、人間ログとは別の `selfplay/` へアップロードする変更です。

```text
Human vs AI:
  source = web_ft5_human_vs_ai
  Worker保存先 = raw/

AI Battle:
  source = web_ft5_ai_battle
  Worker保存先 = selfplay/
```

## 変更ファイル

```text
src/logging.ts
src/main.ts
worker/src/index.ts
tools/build_selfplay_value_dataset.py
README_SELFPLAY_LOGS_VALUE_DATASET.md
```

## Web側

AI BattleのFT5終了時に、自動でselfplayログを `/selfplay` へアップロードします。

AI Battle中のボタン挙動:

```text
Download Logs -> selfplay JSONLを保存
Copy Logs     -> selfplay JSONLをコピー
Upload Logs   -> /selfplay へアップロード
```

Human vs AIの人間ログは従来どおり `raw/` です。

## Worker側

追加endpoint:

```text
POST /selfplay
```

保存先:

```text
selfplay/YYYY-MM-DD/<trainer_version>/<match_id>_<hash>.jsonl
```

人間ログは従来どおり:

```text
raw/YYYY-MM-DD/<trainer_version>/<match_id>_<hash>.jsonl
```

## value dataset作成

selfplay jsonlからvalue用datasetを作れます。

```powershell
python .\tools\build_selfplay_value_dataset.py `
  --input .\collected_selfplay `
  --out .\data\selfplay_value_dataset.jsonl
```

## 方針

```text
policy:
  raw/ の人間ログだけで学習

value:
  selfplay/ のAI Battleログで学習

実行時:
  policy top-k + heuristic + value rerank
```

## 反映

Workerも変わるので通常deployを通してください。

```powershell
git add src/logging.ts src/main.ts worker/src/index.ts tools/build_selfplay_value_dataset.py README_SELFPLAY_LOGS_VALUE_DATASET.md
git commit -m "Upload AI battle logs as selfplay data"
git push
```
