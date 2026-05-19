# Quota fix and value model timestamp display

## 1. QuotaExceededError対策

Human vs AIのFT15でも、ログ全文をlocalStorageへ保存しないようにしました。

原因:

```text
FT15でhuman match logが巨大化
↓
MatchLogger.persistLocal()
↓
localStorage.setItem("tetraflux_last_match_log", huge_jsonl)
↓
QuotaExceededError
↓
finishRound() が途中停止
↓
AI / game loop が止まる
```

修正後:

```text
tetraflux_last_match_log:
  保存しない

tetraflux_last_match_log_meta:
  matchId / records / currentRound / updatedAt だけ保存
```

Selfplay側も同じく、全文ではなくmetadataだけ保存します。

ログ本体はメモリ上に残るので、ページを閉じる前ならDownload Logs / Upload Logsは使えます。

## 2. Value modelの学習時刻表示

`public/models/web_value.json` が存在する場合、Status欄にValue情報を表示します。

対応キー:

```text
model_name / model_id / checkpoint_name
exported_at / trained_at / created_at
training_summary.train_n
training_summary.dataset_n
training_summary.best_val_loss / best_val_mae
```

表示例:

```text
Value
model: selfplay_value_run123
trained: 2026-05-19T...
value ops: 123,456
val: 0.1234
```

まだ `web_value.json` が無い場合は:

```text
Value
value: none
```

と出ます。

## 変更ファイル

```text
src/logging.ts
src/main.ts
README_QUOTA_FIX_VALUE_INFO.md
```

## 反映

```powershell
git add src/logging.ts src/main.ts README_QUOTA_FIX_VALUE_INFO.md
git commit -m "Fix log quota errors and show value model info"
git push
```
