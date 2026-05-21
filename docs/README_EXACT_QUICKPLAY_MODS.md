
## 変更内容

ユーザー指定のmod一覧に合わせて、仮presetを置き換えました。

```text
No Hold
Messier Garbage
Gravity
Volatile Garbage
Double Hole Garbage
Invisible
All-Spin
Expert Mode
```

## 各modの実装

### No Hold

Holdを無効化します。

### Messier Garbage

garbage穴が散らばりやすくなります。

```ts
garbageScatterChance: 0.42
```

### Gravity

Zenith中のプレイヤー重力を強くします。

```ts
gravityMultiplier: 2.15
```

### Volatile Garbage

攻撃力と受けるゴミ量を2倍にします。

```ts
attackMultiplier: 2.0
incomingMultiplier: 2.0
```

### Double Hole Garbage

garbage rowに2つ穴が空くことがあります。

```ts
doubleHoleChance: 0.38
```

`src/engine/tetris.ts` に `setGarbageOptions()` を追加し、engine側のgarbage生成で処理します。

### Invisible

置いたミノを通常時は不可視にします。  
5秒周期で短く点滅します。garbageと穴は常に見えます。

```text
visible blink:
  5秒周期の先頭0.75秒
```

### All-Spin

non-T spinをfull spin寄りの攻撃に昇格します。  
同じactionを連続するとWoundとしてgarbageを受けます。

```ts
repeatedActionWound: 4
```

簡易判定キー:

```text
piece:spin:lines:rot:hold
```

### Expert Mode

以下を適用します。

```text
incoming pressure増加
targeted pressure増加
instant entry garbage
climb loss増加
cancelDoesNotClimbフラグ
bot skill微増
```

## 注意

All-SpinとExpert Modeは、TetraFluxの簡易engineに合わせた近似実装です。  
特にAll-Spinの「same action」判定は、TETR.IO完全再現ではなく、TetraFluxのログ/配置表現で扱える形にしています。

## 変更ファイル

```text
src/main.ts
src/engine/tetris.ts
src/render.ts
README_EXACT_QUICKPLAY_MODS.md
```

## 反映

```powershell
git add src/main.ts src/engine/tetris.ts src/render.ts README_EXACT_QUICKPLAY_MODS.md
git commit -m "Implement exact Quick Play mod set"
git push
```
