# Zenith Tower feed, burst garbage, and floor borders

## 変更内容

### 1. 誰が誰をKOしたか表示

bot同士の死亡時に、近くで火力が高いbotをkillerとして推定し、feedに表示します。

```text
stack_01a KO'd miso_9q2 at 812.4m
you KO'd zen_abc at 244.0m
```

これは本物の盤面対戦ではなくstats simulationなので、厳密なlast-hitではありません。  
ただし「誰が誰を倒したか」は見えるようになります。

### 2. garbageを毎秒連続ではなく、まとめて送る

旧:

```text
incoming rate
↓
1ライン溜まるたび即queue
```

新:

```text
incoming pressureを内部に蓄積
↓
約3.2秒ごとにburst
↓
最大6ラインずつqueue
```

設定:

```ts
ZENITH_GARBAGE_BURST_INTERVAL_MS = 3200
ZENITH_GARBAGE_BURST_MAX_LINES = 6
```

### 3. Zenith Towerの攻撃量をさらに弱める

100人mock botが全員攻撃しているようにならないよう、pressureをさらに下げました。

```ts
ZENITH_NEAR_PRESSURE_SCALE = 0.075
ZENITH_TOP_PRESSURE_SCALE = 0.012
ZENITH_BASE_MAX_INCOMING = 0.18
ZENITH_MAX_INCOMING = 1.35
```

### 4. 初期状態で1000m付近のbotを15人程度配置

botはルール上0.0mから参加します。  
ただし初期botは「0.0mから既に登っていた」扱いでprewarmし、さらに15人程度を1000m付近に置きます。

```ts
ZENITH_INITIAL_HIGH_CLIMBERS = 15
ZENITH_HIGH_CLIMBER_MIN_M = 860
ZENITH_HIGH_CLIMBER_MAX_M = 1180
```

### 5. 階層切り替え

heightがborderを超えたらfloorを切り替え、feedにも表示します。

```text
entered The Skyline at 1001.2m
```

現状のfloor listはmock用の近似です。

```text
Hall of Beginnings: 0m
The Hotel: 250m
The Casino: 500m
The Lounge: 750m
The Skyline: 1000m
The Stratosphere: 1300m
The Orbit: 1650m
The Singularity: 2050m
The Zenith: 2500m
Beyond: 3000m
```

## 注意

調べた範囲では、Quick Play / Zenith Towerが「爬塔モード」で、Hall of Beginnings / The Hotel / The Casinoなどを含む10段階がある、という情報は見つかりました。  
ただし、現行バージョンの正確なborder meter表は信頼できる公開ソースを確認できなかったため、ここでは編集しやすい定数として近似実装しています。

## 変更ファイル

```text
src/main.ts
README_ZENITH_FEED_BURST_FLOORS.md
```

## 反映

```powershell
git add src/main.ts README_ZENITH_FEED_BURST_FLOORS.md
git commit -m "Improve Zenith feed bursts and floor transitions"
git push
```
