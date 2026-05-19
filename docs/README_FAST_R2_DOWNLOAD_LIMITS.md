# Fast R2 download limits for GitHub Actions

## 原因

`max_objects = 0` のままだと、R2の `raw/` 全体をlist/downloadしようとします。

ログが増えると:

```text
list raw/ 全体
↓
全jsonl候補を集める
↓
大量download
↓
GitHub ActionsがDownload logs from R2で数分〜十数分止まる
```

になります。

特にR2 keyは:

```text
raw/YYYY-MM-DD/...
selfplay/YYYY-MM-DD/...
```

なので、`raw/` 全体ではなく日付prefixで絞るべきです。

## 変更内容

### 1. recent-days

追加:

```text
--recent-days 14
```

これで:

```text
raw/2026-05-19/
raw/2026-05-18/
...
```

のように最近の日付prefixだけlistします。

### 2. max_objects default

```text
0 → 500
```

に変更しました。

### 3. max_total_mb

追加:

```text
--max-total-mb 96
```

合計ダウンロード量を96MB程度に制限します。

### 4. newer first

`LastModified` の新しい順に並べて、新しいログから選びます。

### 5. progress表示

listing / selected / download progressを出すようにしました。

```text
list prefix: s3://tetraflux-logs/raw/2026-05-19/
listed total pages=...
jsonl_objects_selected=...
download 1/500 ...
```

## 変更ファイル

```text
tools/download_r2_logs.py
.github/workflows/train-from-r2.yml
README_FAST_R2_DOWNLOAD_LIMITS.md
```

## 反映

```powershell
git add tools/download_r2_logs.py .github/workflows/train-from-r2.yml README_FAST_R2_DOWNLOAD_LIMITS.md
git commit -m "Limit R2 log downloads in training workflow"
git push
```

## いま止まっているGA

止めてOKです。  
この修正を入れたあと、workflow_dispatchで:

```text
max_objects = 500
max_total_mb = 96
recent_days = 14
```

ぐらいで回してください。

急ぐなら:

```text
max_objects = 100
max_total_mb = 32
recent_days = 3
```

で試すのが安全です。
