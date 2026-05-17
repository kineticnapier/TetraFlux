# TetraFlux Web FT5 Trainer

TetraFlux Web FT5 Trainer は、Tetris系AIのための **Web Human-in-the-loop 学習環境** です。

人間がWeb上の自作Tetris環境でAIとFT5形式の対戦を行い、そのときの配置操作ログを収集します。集めたログはCloudflare R2に保存され、GitHub Actionsから学習・Web用モデルexport・Cloudflare Pagesへの再deployまで行えます。

## 目的

```text
1. Web上で人間 vs AI のFT5対戦を行う
2. 人間の配置操作をJSONLとして記録する
3. match終了時にログを自動アップロードする
4. R2に溜まったログからpolicyを学習する
5. Web用JSONモデルにexportする
6. Web trainer側でAIとして読み込む
```

## 現在の主な機能

```text
Web FT5対戦:
  Human vs AI
  FT5(first to 5)形式
  AI mino/s指定
  match終了時の自動ログアップロード

Tetris環境:
  10x20 visible board + hidden rows
  7種1巡
  hold
  next表示
  ghost表示
  SRS 90° kick
  SRS-like 180° kick
  T-spin / mini 簡易検出
  B2B / combo
  TETR.IO-like garbage / countering
  player gravity
  lock delay
  SDF

操作:
  DAS / ARR
  SDF
  Settings popup
  キー割り当て変更
  複数キー割り当て

ログ:
  JSONL保存
  Download Logs
  Upload Logs
  Copy Logs
  match終了時Auto Upload
  Cloudflare Worker経由でR2保存

オンライン表示:
  今プレイ中の人数を簡易表示
  Worker + R2 presence方式

AI:
  HeuristicAI fallback
  WebPolicyAI
  policy top-k + heuristic rerank
  学習操作数 / dataset数 / test精度表示
```

## 注意

```text
TETR.IO本体とは通信しません。
TETR.IO完全再現ではありません。
火力表・SRS+・spin判定・garbage挙動はTETR.IO寄せの簡易実装です。
AIはまだ弱いです。
```

このtrainerは、TETR.IOを直接操作するbotではなく、学習データ収集用の安全なWeb sandboxです。

---

# 起動

## 必要環境

```text
Node.js 22推奨
npm
```

## install

```powershell
npm install
```

## 開発サーバー

```powershell
npm run dev
```

## build

```powershell
npm run build
```

## preview

```powershell
npm run preview
```

---

# 操作

デフォルト操作:

```text
Left:
  Left

Right:
  Right

Soft drop:
  Down

Hard drop:
  Space

Rotate CCW:
  Ctrl, Z

Rotate CW:
  Up, X

Rotate 180:
  A

Hold:
  Shift, C

Next round:
  Enter

Reset match:
  R
```

`Settings` ボタンから変更できます。

複数キーはカンマ区切りで指定できます。

```text
Ctrl, Z
Up, X
Shift, C
```

---

# Settings

`Settings` popupで変更できる項目です。

```text
AI mino/s:
  AIの配置速度

DAS ms:
  横移動開始までの遅延

ARR ms:
  横移動の連続間隔
  0にするとDAS後に壁まで一気に移動

SDF cells/s:
  soft drop速度
  60を超えると即落下寄り

Gravity cells/s:
  human側の自然落下速度

Lock delay ms:
  接地してから自動lockされるまでの時間

Key bindings:
  各操作キー
```

設定はlocalStorageに保存されます。

---

# ログ収集

## 自動アップロード

FT5 matchが終了すると、自動で現在match全体のJSONLがアップロードされます。

```text
match終了
↓
logger.toJsonl(false)
↓
WorkerへPOST
↓
R2に保存
```

失敗した場合でも、手動回収用に以下のボタンが使えます。

```text
Download Logs
Upload Logs
Copy Logs
```

## ログ形式

1行1操作のJSONLです。

主な内容:

```text
trainer_version
anonymous_player_id
match_id
round_index
step_index
state
ai_state
human_action
result
round_winner
match_score_after_round
created_at_ms
```

---

# Cloudflare構成

TetraFluxではCloudflareを次のように使います。

```text
Cloudflare Pages:
  Web trainer本体を配信

Cloudflare Worker:
  ログアップロードAPI
  presence API

Cloudflare R2:
  JSONLログ保存
  最新web_policy.json保存
  presence情報保存
```

## Pages

Web本体はViteでbuildした `dist/` をCloudflare Pagesへdeployします。

```text
dist/
  index.html
  assets/*
  models/web_policy.json
```

通常、公開URLは以下のようなProduction URLです。

```text
https://<project-name>.pages.dev
```

Production URLはdeployごとには変わりません。  
Preview deployment URLはdeployごと・branchごとに変わる場合があります。

## Worker

Workerは以下を受け持ちます。

```text
POST /
  JSONL upload

GET /presence
POST /presence
  今プレイ中の人数表示
```

## R2保存先

ログ:

```text
raw/YYYY-MM-DD/<trainer_version>/<match_id>_<hash>.jsonl
```

最新Webモデル:

```text
models/latest/web_policy.json
```

presence:

```text
presence/<anonymous_player_id>.json
```

---

# Cloudflare初期設定

## 1. R2 bucket作成

```powershell
npx wrangler@latest login
npx wrangler@latest r2 bucket create tetraflux-logs
```

## 2. Worker deploy

```powershell
cd worker
npm install
npx wrangler@latest deploy
cd ..
```

Worker URL例:

```text
https://tetraflux-log-upload.<your-subdomain>.workers.dev
```

## 3. Pages project作成

```powershell
npx wrangler@latest pages project create tetraflux --production-branch main
```

すでにDashboard側で作っているなら不要です。

## 4. 初回Pages deploy

```powershell
npm run build
npx wrangler@latest pages deploy dist --project-name=tetraflux --branch=main
```

---

# GitHub Actions設定

GitHub repositoryの:

```text
Settings
→ Secrets and variables
→ Actions
```

に設定します。

## Repository secrets

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

## Repository variables

```text
CF_PAGES_PROJECT_NAME
VITE_LOG_UPLOAD_URL
```

任意:

```text
R2_LOG_BUCKET = tetraflux-logs
R2_LOG_PREFIX = raw/
R2_MODEL_KEY = models/latest/web_policy.json
```

## Tokenの使い分け

```text
CLOUDFLARE_API_TOKEN:
  wrangler deploy
  wrangler pages deploy
  worker deploy

R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY:
  R2 S3-compatible API用
  GitHub ActionsからR2ログやモデルを読み書きする
```

---

# GitHub Actions workflows

## Deploy to Cloudflare with Wrangler

```text
.github/workflows/deploy-cloudflare.yml
```

push時に実行されます。

処理:

```text
1. Worker deploy
2. R2から最新web_policy.jsonを取得
3. npm build
4. Cloudflare Pagesへdeploy
```

通常deployが古いモデルで上書きしないように、build前にR2から最新モデルを同期します。

## Train policy from R2 logs

```text
.github/workflows/train-from-r2.yml
```

手動実行します。

```text
Actions
→ Train policy from R2 logs
→ Run workflow
```

処理:

```text
1. R2からJSONLログをdownload
2. merge
3. audit
4. filter
5. dataset作成
6. policy学習
7. web_policy.jsonへexport
8. R2へ最新モデルとしてupload
9. npm build
10. Cloudflare Pagesへdeploy
11. artifact保存
```

## GitHub Pages

Cloudflare Pagesを使うため、GitHub Pages workflowは基本不要です。

---

# 学習

## 手元で学習する場合

ログをまとめます。

```powershell
python .\tools\merge_jsonl.py `
  --input .\collected_logs `
  --out .\data\merged_web_logs.jsonl
```

audit:

```powershell
python .\tools\audit_web_logs.py `
  --input .\data\merged_web_logs.jsonl `
  --out .\data\audit_web_logs.json
```

filter:

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

dataset作成:

```powershell
python .\tools\build_web_dataset.py `
  --input .\data\merged_web_logs_clean.jsonl `
  --out .\data\web_human_dataset.jsonl
```

学習:

```powershell
python .\tools\train_web_policy.py `
  --data .\data\web_human_dataset.jsonl `
  --out-dir .\models\web_human_policy `
  --epochs 30 `
  --batch-size 256 `
  --device cpu
```

Web用export:

```powershell
python .\tools\export_web_policy_json.py `
  --checkpoint .\models\web_human_policy\best_policy.pt `
  --out .\public\models\web_policy.json `
  --model-name local_test
```

## GitHub Actionsで学習する場合

`Train policy from R2 logs` を実行します。

最初は軽め:

```text
epochs = 20
max_objects = 50
```

動作確認後:

```text
epochs = 50
max_objects = 0
```

## 学習量の目安

```text
〜1,000 ops:
  動作確認用

5,000〜20,000 ops:
  それっぽい癖は出るが弱い

50,000〜100,000 clean ops:
  HybridAIなら多少意味が出始める

200,000〜500,000 clean ops:
  imitation policyとして使いやすくなる

1,000,000 ops〜:
  policy単体でも多少まともにしたい場合の目安
```

重要なのは量だけでなくcleanさです。

```text
入れたい:
  人間勝利round
  穴が少ないround
  高さが低〜中程度
  garbage対応できているround
  操作仕様修正後のログ

避けたい:
  負けround
  穴だらけround
  テスト中の雑なround
  古いtrainer version
  バグがあった時期のログ
```

---

# AIについて

## HeuristicAI

盤面評価で手を選ぶAIです。

見ている主な値:

```text
holes
height
bumpiness
wells
line clear
attack
topout
```

現状では、学習policyよりHeuristicAIの方が強い場合があります。

## WebPolicyAI / HybridAI

Web用にexportされた `web_policy.json` を読み込みます。

現在は単純なpolicy単体ではなく、以下のハイブリッドです。

```text
1. policyが合法手を順位付け
2. 上位top-kを候補にする
3. HeuristicAIで盤面評価
4. policy順位penaltyを少し足してrerank
```

AI欄には以下が表示されます。

```text
model id
exported_at
learned ops
dataset ops
best epoch
test accuracy
mode
```

---

# データ汚染に注意

このプロジェクトでは、ログ品質がAI性能に直結します。

特に、次のようなログはAIを弱くしやすいです。

```text
操作確認だけの雑なプレイ
仕様バグがあった時期のログ
負け続けたログ
穴だらけの盤面
AIが明らかに変な仕様だった時期の対戦
```

ログを大量に集める前に、trainer仕様をなるべく固定してください。

---

# ディレクトリ概要

```text
src/
  Web trainer本体

src/engine/
  Tetris環境

src/ai/
  HeuristicAI
  WebPolicyAI

src/input.ts
  DAS / ARR / SDF / key input

src/logging.ts
  JSONL log生成・upload

src/presence.ts
  playing now表示

worker/
  Cloudflare Worker
  upload endpoint
  presence endpoint

tools/
  ログmerge / audit / filter
  dataset作成
  学習
  R2 download
  model export
  model sync

public/models/
  Web用model json
  ※生成物なので基本的にGit管理しない

.github/workflows/
  Cloudflare deploy
  R2 log training
```

---

# よくあるトラブル

## Rollup optional dependency error

GitHub Actionsで:

```text
Cannot find module @rollup/rollup-linux-x64-gnu
```

が出る場合があります。  
workflow側では `npm ci` ではなく、Linux runner上でoptional dependencyを入れ直す形にしています。

```bash
rm -rf node_modules package-lock.json
npm install --include=optional --no-audit --no-fund
```

## web_policy.jsonが古い

通常deployが古い `public/models/web_policy.json` をdeployすると、新モデルが戻ることがあります。

対策:

```text
train workflow:
  最新モデルをR2へupload

normal deploy:
  build前にR2から最新モデルをdownload
```

また、`public/models/web_policy.json` はGit管理しない方が安全です。

```powershell
git rm --cached public/models/web_policy.json
```

## Upload Logsが失敗する

確認:

```text
VITE_LOG_UPLOAD_URL が設定されているか
Workerがdeployされているか
WorkerのR2 bindingが正しいか
CORSが通っているか
trainer_versionがWorkerの許可リストに入っているか
```

## playing nowが ? のまま

確認:

```text
VITE_LOG_UPLOAD_URL が設定されているか
Workerの /presence がdeployされているか
R2 bucket bindingが正しいか
```

---

# 今後の改善候補

```text
TETR.IO SRS+へのさらなる寄せ
火力表の精密化
garbage timingの精密化
spin判定の改善
操作ログにkey timingも入れる
DAgger風の修正局面収集
policy/value hybrid
AI同士のsandbox評価
学習済みモデルのA/B比較
```

## License

未設定。
