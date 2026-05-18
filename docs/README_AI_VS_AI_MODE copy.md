# AI vs AI mode

## 追加内容

別モードとして `AI Battle` を追加しました。

Toolbarに追加:

```text
Mode: Human vs AI
```

押すたびに切り替わります。

```text
Human vs AI
AI Battle
```

## 対戦内容

```text
左:
  現在読み込まれているHybridAI / WebPolicyAI

右:
  HeuristicAI
```

`web_policy.json` が読み込めなかった場合は、左もHeuristicAI fallbackになります。

## 重要: AI Battleはログアップロードしない

AI同士の操作を学習ログに混ぜるとデータ汚染になるため、AI Battle中は:

```text
自動アップロードしない
手動Upload Logsもしない
logger.finishRoundもしない
```

ようにしています。

## スコア表示

Human側のスコア枠を左AI、AI側のスコア枠を右AIとして使います。

```text
HybridAI 5 - 3 HeuristicAI
```

のように表示されます。

## 使い方

```text
1. Modeボタンを押してAI Battleへ
2. New FT5
3. AI mino/sで速度調整
4. 終わったらModeボタンでHuman vs AIへ戻す
```

## 変更ファイル

```text
index.html
src/main.ts
README_AI_VS_AI_MODE.md
```
