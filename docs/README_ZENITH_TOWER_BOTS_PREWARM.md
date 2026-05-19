# Zenith Tower mock mode, B案

## 追加内容

`Mode` ボタンを押すと、次の3モードを切り替えます。

```text
Human vs AI
AI Battle
Zenith Tower
```

## Zenith Towerの仕様

### プレイヤー

プレイヤーは通常通り本物の `TetrisEngine` で操作します。

```text
R:
  Zenith Tower開始

ライン消し / 攻撃:
  heightM が増える
  近くのbotへ攻撃を分配

topout:
  run終了
```

### bot

botは本物のTetrisEngineではなく、Zenith Tower用の軽量stats simulationです。

```text
持つ値:
  heightM
  skill
  pps
  attackRate
  boardHeight
  holes
  pendingGarbage
  attackTotal
```

## B案: 最初から塔が動いていた扱い

新規joinは必ず0.0mです。

```text
bot joined at 0.0m
```

ただし初期配置のbotは:

```text
joinedAtMs = now - random(0..180s)
heightM = 0.0mから事前simulateした結果
```

なので、ルール上は全員0.0mから入っていますが、ゲーム開始時点で塔にはすでに上の方のbotもいます。

## 定期join

ゲーム中もbotは定期的に0.0mから入ってきます。

```text
1〜3秒ごと:
  bot_xxx joined at 0.0m
```

## pressure

プレイヤーへのgarbage pressureは、近い高さのbot中心に計算します。

```text
nearby:
  |bot.heightM - player.heightM| <= 85m
```

遠く下にいる新規join botは、すぐにはプレイヤーへ干渉しません。

## UI

Zenith Towerでは右側に以下を表示します。

```text
height
rank
alive
nearby
incoming
leaderboard
feed
```

## 注意

これはTETR.IO Quick Play / Zenith Towerの完全再現ではなく、TetraFlux用の軽量擬似Zenithです。  
100人前後のbotが軽く動いて、join/leave/pressure/rankを作る段階です。

## 変更ファイル

```text
src/main.ts
README_ZENITH_TOWER_BOTS_PREWARM.md
```

## 反映

```powershell
git add src/main.ts README_ZENITH_TOWER_BOTS_PREWARM.md
git commit -m "Add Zenith Tower mock bot mode"
git push
```
