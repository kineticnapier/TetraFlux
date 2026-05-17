# Train from R2 logs with GitHub Actions

## どこにファイルが置かれるか

GitHub Actions内で作られるファイルは、基本的に **runnerの一時workspace** に置かれます。

```text
collected_logs_r2/                 R2から落としたログ。一時ファイル
data/                              merge/audit/filter/dataset。一時ファイル
models/web_human_policy_r2/        best_policy.ptなど。一時ファイル
public/models/web_policy.json      Web用にexportされたモデル。一時ファイル
dist/                              npm run buildの出力。一時ファイル
```

runnerの一時workspaceは、workflowが終わると消えます。  
永続化されるのは次の2つです。

```text
Actions Artifact:
  public/models/web_policy.json
  best_policy.pt
  summary.json
  audit_r2_logs.json
  など

Cloudflare Pages:
  dist/ の中身
  つまり dist/models/web_policy.json がWebに反映される
```

このworkflowはGitHub repoには自動commitしません。  
モデルやdatasetをGitに入れると重くなるので、基本はArtifact + Cloudflare Pages反映で十分です。

## 追加ファイル

```text
.github/workflows/train-from-r2.yml
tools/download_r2_logs.py
README_TRAIN_FROM_R2_GA.md
```

## 必要なGitHub Secrets

Repository Settings → Secrets and variables → Actions → Secrets

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

## 必要なGitHub Variables

Repository Settings → Secrets and variables → Actions → Variables

```text
CF_PAGES_PROJECT_NAME
VITE_LOG_UPLOAD_URL
```

任意:

```text
R2_LOG_BUCKET = tetraflux-logs
R2_LOG_PREFIX = raw/
```

指定しない場合:

```text
R2_LOG_BUCKET = tetraflux-logs
R2_LOG_PREFIX = raw/
```

## 実行方法

GitHubのActionsタブから:

```text
Train policy from R2 logs
→ Run workflow
```

入力:

```text
epochs
batch_size
max_objects
max_holes
max_height
min_round_length
model_name
```

最初は軽く:

```text
epochs = 20
max_objects = 50
```

で確認するのがおすすめです。

## 処理内容

```text
1. R2から raw/ 以下の .jsonl をdownload
2. merge_jsonl.py
3. audit_web_logs.py
4. filter_web_logs.py
5. build_web_dataset.py
6. train_web_policy.py
7. export_web_policy_json.py
8. npm run build
9. wrangler pages deploy dist
10. Actions Artifactにモデル・summary・auditを保存
```

## Artifactの場所

GitHub Actionsの実行結果ページで:

```text
Summary
→ Artifacts
→ tetraflux-trained-policy-r2-run-...
```

からダウンロードできます。

中身:

```text
public/models/web_policy.json
models/web_human_policy_r2/best_policy.pt
models/web_human_policy_r2/summary.json
models/web_human_policy_r2/history.json
models/web_human_policy_r2/actions.json
data/audit_r2_logs.json
data/merged_r2_logs_clean.meta.json
data/web_human_dataset_r2.meta.json
collected_logs_r2/_download_summary.json
```

## Webに反映される場所

Cloudflare Pages上では:

```text
/models/web_policy.json
```

として配信されます。

Web trainer起動時に `models/web_policy.json` を読み込むので、deploy成功後は新モデルが使われます。

## 注意

GitHub Actionsのubuntu runnerは基本CPUです。大きいdatasetだと遅いです。

最初は:

```text
max_objects = 50
epochs = 20
```

くらいで動作確認してください。

十分動いたら:

```text
max_objects = 0
epochs = 50
```

にします。
