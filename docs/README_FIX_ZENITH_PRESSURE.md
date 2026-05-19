# Fix Zenith Tower pressure

## 原因

Zenith Towerのbotは本物の攻撃ではなく `attackRecent` という脅威値を持っています。

しかし前の実装では、近くのbot全員分をほぼそのまま合計していました。

```ts
nearbyAttack = nearby.reduce(...)
incoming = nearbyAttack * 0.018 + ...
```

100人近いbotがいると、1人1人は軽い攻撃でも合計が大きくなり、1PPSでも毎秒数十ラインのgarbageが来ていました。

## 修正内容

### 1. 合計ではなく平均を見る

旧:

```ts
nearbyAttack sum
```

新:

```ts
nearbyAverage = nearbyAttack / nearby.length
topAverage = topAttack / topBots.length
```

### 2. 開始直後の猶予を追加

```ts
ZENITH_GRACE_MS = 8000
ZENITH_RAMP_MS = 45000
```

開始8秒はpressureなし、その後45秒かけて上がります。

### 3. garbage/secに上限を追加

```ts
ZENITH_BASE_MAX_INCOMING = 0.75
ZENITH_MAX_INCOMING = 4.0
```

高度が低い間は最大0.75 lines/s程度、上に行くほど最大4 lines/sまで上がります。

## 変更ファイル

```text
src/main.ts
README_FIX_ZENITH_PRESSURE.md
```

## 反映

```powershell
git add src/main.ts README_FIX_ZENITH_PRESSURE.md
git commit -m "Fix Zenith Tower garbage pressure"
git push
```
