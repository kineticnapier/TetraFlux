# Fix R2 download step debug

## 症状

GitHub Actionsで:

```text
Run python tools/download_r2_logs.py ...
+ npx wrangler@latest r2 object list tetraflux-logs --prefix raw/ --json
CalledProcessError
```

だけ出て、Cloudflare/Wrangler側の本当のエラーが見えていませんでした。

## 原因

前の `tools/download_r2_logs.py` は `subprocess.run(..., check=True)` で落ちていて、失敗時の `stderr` を表示していませんでした。

つまり、本当は:

```text
認証失敗
token権限不足
bucket名違い
account違い
prefix違い
wrangler command変更
```

などのどれかですが、その詳細が隠れていました。

## 今回の修正

```text
tools/download_r2_logs.py
.github/workflows/train-from-r2.yml
```

を更新しました。

追加した確認:

```text
npx --yes wrangler@latest --version
npx --yes wrangler@latest whoami
npx --yes wrangler@latest r2 bucket list
npx --yes wrangler@latest r2 object list ...
```

失敗時も stdout / stderr を表示します。

## 次に見るところ

この修正後にもう一度Actionsを実行して、`Download logs from R2` のstderrを見てください。

よくある原因:

```text
1. CLOUDFLARE_API_TOKEN に R2 権限がない
2. CLOUDFLARE_ACCOUNT_ID が違う
3. R2 bucket名が違う
4. bucketにまだ .jsonl がない
5. prefixが raw/ ではない
```

## 必要なToken権限

学習workflowではR2から読むので、少なくとも:

```text
Workers R2 Storage: Read
```

が必要です。

同じtokenでWorker deployやPages deployもするなら:

```text
Cloudflare Pages: Edit
Workers Scripts: Edit
Workers R2 Storage: Edit
Account Settings: Read
```

あたりにしておくと楽です。
