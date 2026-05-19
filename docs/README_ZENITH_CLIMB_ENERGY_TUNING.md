# Zenith climb energy tuning

## 問題

Zenith Towerで登りづらすぎた原因は、攻撃による上昇量が小さすぎたことです。

旧:

```ts
attackEnergy = result.attackSent * 0.19
```

つまり1 attackで0.19m程度しか登れませんでした。

## 修正内容

### 1. 攻撃1ライン ≒ 1.2m

```ts
const ZENITH_ATTACK_M_PER_LINE = 1.2;
```

### 2. 大きい攻撃は8m前後まで伸びる

```ts
const ZENITH_BIG_ATTACK_SOFT_CAP_M = 8.0;
const ZENITH_BIG_ATTACK_EXTRA_M = 0.22;
```

小〜中火力はほぼ `attack * 1.2m`、大火力は8m付近から緩やかに伸びます。

### 3. KOで+25m

```ts
const ZENITH_KO_BONUS_M = 25.0;
```

botを倒した場合、倒した人数分だけ加算します。

```text
you KO'd xxx at 244.0m (+25m)
```

### 4. comboでも伸びる

```ts
const ZENITH_COMBO_M = 0.32;
const ZENITH_COMBO_QUAD_M = 0.018;
const ZENITH_COMBO_MAX_M = 5.5;
```

comboが伸びるほど追加で登ります。  
上限は一旦5.5mです。

### 5. feedに大きい上昇を表示

大きく登った時はfeedに出します。

```text
+8.4m atk=6 combo=3
+32.1m atk=5 combo=2 KO=1
```

## 変更ファイル

```text
src/main.ts
README_ZENITH_CLIMB_ENERGY_TUNING.md
```

## 反映

```powershell
git add src/main.ts README_ZENITH_CLIMB_ENERGY_TUNING.md
git commit -m "Tune Zenith climb energy"
git push
```
