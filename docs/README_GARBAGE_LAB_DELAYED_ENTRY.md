# Garbage Lab delayed garbage entry

## 変更内容

### 1. 実験場の表記を英語化

`実験場` 表記を `Garbage Lab` に変更しました。

Mode切り替え:

```text
Human vs AI
AI Battle
Garbage Lab
Zenith Tower
```

### 2. garbageを即投入しないように変更

旧仕様:

```text
1 bag終了
↓
即 queueGarbage()
```

新仕様:

```text
1 bag終了
↓
garbageをwarning queueに追加
↓
2.5秒後にready状態になる
↓
ready状態で次にミノを置いた瞬間、盤面にgarbageが入る
```

### 3. 表示項目を追加

Garbage Labパネルに追加:

```text
delay
scheduled
queued warning
ready
next ready
entered board
```

### 4. mod影響

garbage量は `incomingMultiplier` の影響を受けます。  
穴配置はengine側の `setGarbageOptions()` によって、Messier Garbage / Double Hole Garbage の影響を受けます。

## 変更ファイル

```text
src/main.ts
README_GARBAGE_LAB_DELAYED_ENTRY.md
```

## 反映

```powershell
git add src/main.ts README_GARBAGE_LAB_DELAYED_ENTRY.md
git commit -m "Add delayed garbage entry to Garbage Lab"
git push
```
