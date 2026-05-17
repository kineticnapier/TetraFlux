# Fix stale web_policy.json

## 症状

学習workflowは成功したのに、Web側で表示されるモデルが古い:

```text
2026-05-17T05:27:45Z
```

## 起きがちな原因

```text
1. ブラウザ/Cloudflare edgeが /models/web_policy.json をキャッシュしている
2. npm run build後の dist/models/web_policy.json が古い
3. 通常のCloudflare Pages deploy workflowが、古い public/models/web_policy.json を再deployして上書きした
```

## 今回の修正

```text
public/_headers
  /models/* と /*.json を no-store にする

src/ai/webPolicy.ts
  /models/web_policy.json?t=<Date.now()> で読み込む
  console.logにもmodel_id/exported_atを出す

.github/workflows/train-from-r2.yml
  export直後の public/models/web_policy.json を表示
  build後の dist/models/web_policy.json を表示
  dist/_headers もartifactに保存
```

## 確認方法

Actionsの `Inspect exported model before build` と `Inspect dist model before deploy` を見ます。

両方で新しい `exported_at` が出ていれば、buildまでは成功です。

ブラウザではDevTools Consoleに:

```text
[TetraFlux] loaded web policy
```

としてURLとmodel_idが出ます。

## 注意

もしこの修正後も古い場合は、通常の `Deploy to Cloudflare with Wrangler` workflowが古いモデル入りdistを後からdeployして上書きしている可能性が高いです。

その場合は:

```text
1. repo内の public/models/web_policy.json を消す
2. public/models/web_policy.json を .gitignore する
3. 通常deployではmodelを含めない
4. train-from-r2 workflowだけがmodel入りdistをdeployする
```

方向に切り替えます。
