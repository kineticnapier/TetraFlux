# Presence / Gravity / Settings popup / Continuous garbage countering

## 追加内容

### 1. 今n人プレイ中カウンター

Frontend:

```text
src/presence.ts
```

が `VITE_LOG_UPLOAD_URL + /presence` に15秒ごとにpingします。

Worker:

```text
worker/src/index.ts
```

に `/presence` を追加しました。

R2に:

```text
presence/<anonymous_player_id>.json
```

を保存し、45秒以内に更新されたものを `playing now` として数えます。

### 2. プレイヤー側重力

Human側にgravityとlock delayを追加しました。

```text
Gravity cells/s
Lock delay ms
```

デフォルト:

```text
gravity = 1 cells/s
lock delay = 500 ms
```

接地してlock delayが切れると、現在位置でlockします。Hard dropではありません。

### 3. UI整理

Status panelから `Input` と `Garbage` セクションを消しました。

### 4. Settings popup

Toolbarの `Settings` ボタンで開きます。

変更できるもの:

```text
AI mino/s
DAS
ARR
SDF
Gravity
Lock delay
各操作キー
```

キー入力欄は、フォーカス中に押したキーをそのまま登録します。

### 5. 連続相殺

以前:

```text
自分がattackで一部相殺
↓
残りincoming garbageが即実体化
```

今回:

```text
line clear または attack があるlock:
  残りincoming garbageをまだ実体化しない
  次のclear/attackでも続けて相殺できる

line clearなし + attackなしのlock:
  残りincoming garbageが実体化
```

TETR.IO完全再現ではないですが、連続消しで相殺できる挙動に寄せています。

## 変更ファイル

```text
index.html
src/style.css
src/input.ts
src/main.ts
src/presence.ts
worker/src/index.ts
README_PRESENCE_GRAVITY_SETTINGS_COUNTERING.md
```

## 必要なdeploy

Workerにも変更があるので、Cloudflare deploy workflowを通してください。

```powershell
git add .
git commit -m "Add presence gravity settings and continuous garbage countering"
git push
```

## 注意

`playing now` はR2ベースの近似です。

```text
同一ブラウザ/同一anonymous id:
  1人扱い

通信失敗:
  一時的に ? または古い値

45秒以内にpingがある:
  playing扱い
```
