# AI Battle round cap

## 原因

fake spin攻撃を止めた後、AI同士がかなり安定してしまい、roundが終わらないことがあります。

```text
Hybrid vs Heuristic
↓
両方とも穴を抑える
↓
攻撃も相殺される
↓
2600 pieces以上続く
```

これは実戦評価としてもログ収集としても重すぎます。

## 修正内容

AI Battleにround上限を入れました。

```ts
const AI_BATTLE_MAX_TURNS_PER_ROUND = 1200;
```

これは **合計AI配置数** です。  
だいたい片側600ミノずつです。

上限に達したら、topoutではなく盤面評価で勝者を決めます。

## 勝敗判定

低い方が勝ちです。

```text
holes
max height
total height
bumpiness
wells
pending garbage
```

を見ます。

B2B / combo は少しだけ有利評価にします。

表示例:

```text
turn limit 1200:
HybridAI danger=42.1,
HeuristicAI danger=55.8
```

## UI

Status欄に現在のturn数を表示します。

```text
turns: 384/1200
```

## 変更ファイル

```text
src/main.ts
README_AI_BATTLE_ROUND_CAP.md
```

## 反映

```powershell
git add src/main.ts README_AI_BATTLE_ROUND_CAP.md
git commit -m "Add AI battle round cap"
git push
```