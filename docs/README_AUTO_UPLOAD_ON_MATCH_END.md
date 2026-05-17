# Auto upload on FT5 match end

## 変更内容

FT5のmatch終了時に、自動で現在のmatch全体のJSONLをWorkerへuploadします。

```text
round終了:
  uploadしない

FT5 match終了:
  logger.toJsonl(false)
  ↓
  uploadLogs(jsonl)
  ↓
  R2へ保存
```

手動の `Download Logs` / `Upload Logs` ボタンは保険として残しています。

## UI

Status panelに以下を追加しました。

```text
Auto upload
status: idle / uploading / uploaded / failed / skipped
detail...
```

## 失敗時

自動アップロードが失敗しても、match logは `localStorage` に保存され、手動で:

```text
Download Logs
Upload Logs
Copy Logs
```

が使えます。

## 変更ファイル

```text
src/main.ts
```

## 注意

`VITE_LOG_UPLOAD_URL` が設定されていない環境では、自動アップロードは `failed` になります。  
Cloudflare Pages deploy時にGitHub Variablesで `VITE_LOG_UPLOAD_URL` を設定してください。
