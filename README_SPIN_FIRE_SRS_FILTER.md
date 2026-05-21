# Spin fire and SRS terrain filter

## 変更内容

### 1. 作ったSpin形を実際に撃つ処理を追加

これまではsetupを作る評価はありましたが、完成後に通常評価へ戻ってしまい、Spinを撃たないことがありました。

追加:

```text
legal placements
↓
T / All-Spin候補だけ確認
↓
SRS風の移動経路を検証
↓
最後の入力がrotateで、LockResult.spin !== none
↓
即採用
```

`spinFire: true` が `aiInfo` に入ります。

### 2. Spin発火時は「最後の操作が回転」の経路だけ採用

```text
soft / move / rotate
↓
harddrop
```

のように、最後の可視操作が回転で終わるルートだけをSpin発火として扱います。  
これで「形はあるがハードドロップで普通に置いて終わる」ケースを減らします。

### 3. SRS的に入らない地形をplanから除外

T-slot検出時に、完成形だけではなく、

```text
回転前のT footprintがどこかに存在できるか
SRS kickっぽいoffset範囲に空間があるか
```

を軽くチェックします。

これにより、見た目だけT-slotっぽいが実際にはSRSで入らない地形をplan候補から除外します。

### 4. build

`npm run build` で確認済みです。

## 変更ファイル

```text
src/main.ts
README_SPIN_FIRE_SRS_FILTER.md
```
