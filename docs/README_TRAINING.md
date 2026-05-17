# TetraFlux Web Training

Web trainerのログから学習を回すための追加ファイルです。

## フォルダ分け

おすすめ:

```text
project/
  src/                  Web本体
  tools/                ログ処理・学習スクリプト
  collected_logs/       ダウンロードしたjsonl置き場
  data/                 merge後・dataset化後のjsonl
  models/               学習済みモデル
```

`collected_logs/`, `data/`, `models/` は基本的にGit管理しない方がいいです。

## 1. 依存関係

```powershell
pip install -r requirements-training.txt
```

## 2. ダウンロードしたjsonlを集める

```powershell
mkdir collected_logs
```

Web trainerからダウンロードした `.jsonl` を全部ここへ入れます。

## 3. merge

```powershell
python .	ools\merge_jsonl.py `
  --input .\collected_logs `
  --out .\data\merged_web_logs.jsonl
```

## 4. dataset化

人間勝利roundだけ:

```powershell
python .	oolsuild_web_dataset.py `
  --input .\data\merged_web_logs.jsonl `
  --wins-only `
  --out .\data\web_human_dataset.jsonl
```

全人間手:

```powershell
python .	oolsuild_web_dataset.py `
  --input .\data\merged_web_logs.jsonl `
  --out .\data\web_human_dataset_all.jsonl
```

最初は `--wins-only` ありがおすすめです。

## 5. 学習

```powershell
python .	ools	rain_web_policy.py `
  --data .\data\web_human_dataset.jsonl `
  --out-dir .\models\web_human_policy `
  --epochs 50 `
  --batch-size 256 `
  --device auto
```

出力:

```text
models/web_human_policy/best_policy.pt
models/web_human_policy/summary.json
models/web_human_policy/history.json
models/web_human_policy/actions.json
```

## 注意

この `best_policy.pt` はPyTorch用です。  
Webに組み込むには次にONNX変換またはJSON形式へのexportが必要です。
