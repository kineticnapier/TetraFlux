# FT15 AI Battle + selfplay value training

## 変更内容

### 1. AI BattleをFT15に変更

```text
Human vs AI:
  FT5

AI Battle:
  FT15
```

`resetMatch()` 時にmodeを見て `firstTo` を切り替えます。

### 2. selfplay value modelをWebで使用

新規追加:

```text
src/ai/webValue.ts
```

Web起動時に:

```text
/models/web_policy.json
/models/web_value.json
```

を両方読みます。

`web_value.json` が存在する場合、HybridAIのrerankがこう変わります。

```text
policy top-k
↓
heuristic score
↓
selfplay value score
↓
combined score = heuristic + policy penalty - value * 0.25
```

つまり、人間policyで候補を出しつつ、AI Battleから学習した「勝ちやすさ」をrerankに使います。

### 3. GitHub Actionsでselfplay valueを学習

追加workflow:

```text
.github/workflows/train-selfplay-value.yml
```

処理:

```text
1. R2 selfplay/ からAI Battleログをdownload
2. tools/build_selfplay_value_dataset.py でvalue dataset作成
3. tools/train_selfplay_value.py でvalue MLP学習
4. tools/export_web_value_json.py で web_value.json にexport
5. R2 models/latest/web_value.json へupload
6. R2 models/latest/web_policy.json を同期
7. npm build
8. Cloudflare Pages deploy
```

## 追加/変更ファイル

```text
src/main.ts
src/ai/webPolicy.ts
src/ai/webValue.ts
tools/download_r2_jsonl_prefix.py
tools/download_r2_file.py
tools/upload_r2_file.py
tools/train_selfplay_value.py
tools/export_web_value_json.py
.github/workflows/train-selfplay-value.yml
README_FT15_SELFPLAY_VALUE_GA.md
```

既存のselfplay loggingがまだ未反映なら、前回の以下も必要です。

```text
src/logging.ts
worker/src/index.ts
tools/build_selfplay_value_dataset.py
```

今回のzipにはそれらも含めています。

## GitHub Secrets / Variables

必要なsecrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

必要なvariables:

```text
CF_PAGES_PROJECT_NAME
VITE_LOG_UPLOAD_URL
```

任意variables:

```text
R2_LOG_BUCKET = tetraflux-logs
R2_SELFPLAY_PREFIX = selfplay/
R2_VALUE_MODEL_KEY = models/latest/web_value.json
R2_MODEL_KEY = models/latest/web_policy.json
```

## 実行方法

```text
GitHub Actions
→ Train selfplay value model
→ Run workflow
```

最初は:

```text
epochs = 20
max_objects = 20
```

問題なければ:

```text
epochs = 40〜80
max_objects = 0
```

## 注意

これは厳密なonline RLではなく、offline value学習です。

```text
AI Battleでselfplayログを集める
↓
GAでvalue modelを学習
↓
Web側でpolicy + heuristic + value rerank
```

という流れです。

人間ログ `raw/` とAI Battleログ `selfplay/` は混ぜません。
