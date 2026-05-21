# Cancelable gray garbage and red entry cap

## 変更内容

### 1. gray scheduled garbageも常に相殺可能

攻撃を出したとき、まず自分側のincoming garbageを相殺します。

```text
攻撃発生
↓
自分のred readyを相殺
↓
まだ攻撃が残っていればgray scheduledも相殺
↓
それでも残った分だけ相手への攻撃になる
```

### 2. 相殺しきれなかった分は相手攻撃へ

例:

```text
自分のincoming:
  red 2
  gray 3

自分の攻撃:
  8

処理:
  2 + 3 を相殺
  残り3を相手に送る
```

### 3. 1回に盤面へ出るred garbageは最大8ライン

red readyが10ラインある場合:

```text
lock 1:
  red 8 が盤面へ出る
  red 2 は残る

lock 2:
  残りred 2が盤面へ出る
```

## build

`npm run build` で確認済みです。
