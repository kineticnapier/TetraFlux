# Start gate / AI auto-next / chunked uploads

## 変更内容

### 1. selfplay uploadが大きすぎる問題

Worker側の制限を上げました。

```ts
MAX_BYTES = 16 * 1024 * 1024
MAX_LINES = 50000
```

さらに、Web側でJSONLを約3.4MBごとに分割してアップロードするようにしました。

```text
large selfplay jsonl
↓
chunk 1
chunk 2
chunk 3
...
↓
POST /selfplay
```

これで `max_bytes:4194304` に引っかかりにくくなります。

### 2. Human vs AI はRキーで試合開始

Human vs AIでは、ページ表示やNew FT5直後には試合が進みません。

```text
Press R to start Human vs AI
```

と表示され、Rを押してからFT5が開始します。

Rは試合中でも新しいHuman vs AI FT5開始として扱います。

### 3. AI BattleはEnter不要で自動進行

AI Battleではround終了後、約0.7秒後に自動で次roundへ進みます。

```text
Round end
↓
0.7 sec wait
↓
Next round
```

FT5終了時はselfplayログを自動アップロードします。

## 変更ファイル

```text
src/logging.ts
src/main.ts
worker/src/index.ts
README_START_GATE_AI_AUTO_NEXT_CHUNKED_UPLOAD.md
```

## 反映

Workerも変わるのでCloudflare deployを通してください。

```powershell
git add src/logging.ts src/main.ts worker/src/index.ts README_START_GATE_AI_AUTO_NEXT_CHUNKED_UPLOAD.md
git commit -m "Add start gate auto next and chunked uploads"
git push
```
