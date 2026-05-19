# Raise AI PPS and batch simulation

## 原因

PPS 20と50の体感差がなかった主な理由は2つです。

```ts
settings.aiPps = Math.max(0.1, Math.min(20, ...));
const pps = Math.max(0.1, Math.min(20, settings.aiPps));
```

で20に丸められていました。

さらに、内部処理も:

```ts
guard < 5
```

で1frameあたり最大5手に制限されていました。  
60fpsなら、理論上でも片側300PPS程度で頭打ちします。

## 修正内容

### 1. AI PPS上限を1000へ

```ts
const MAX_AI_PPS = 1000;
```

にしました。

HTML側も:

```html
max="1000"
```

に変更しています。

### 2. 1frameあたりの処理手数をPPSに応じて増やす

旧:

```ts
guard < 5
```

新:

```ts
const maxAiActionsPerFrame = Math.max(5, Math.min(200, Math.ceil(pps / 12)));
```

PPSを上げると、1frame内で複数手まとめて処理します。

### 3. 高PPS時は描画をさらに間引く

AI Battle中の高PPSでは、表示より処理を優先します。

```text
PPS >= 50:
  20手ごとぐらいに描画

PPS >= 100:
  40手ごとぐらいに描画

PPS >= 200:
  80手ごとぐらいに描画
```

## 変更ファイル

```text
src/main.ts
index.html
README_RAISE_AI_PPS_BATCH.md
```

## 反映

```powershell
git add src/main.ts index.html README_RAISE_AI_PPS_BATCH.md
git commit -m "Raise AI PPS limit and batch simulation"
git push
```