# Fix Zenith leaders type

## 原因

`leaders()` 内の `rows` が、最初の `map()` から次の型として推論されていました。

```ts
{
  name: string;
  heightM: number;
  attack: number;
  alive: boolean;
}[]
```

その後にプレイヤー行を追加するとき:

```ts
rows.push({
  name: "you",
  ...,
  player: true
});
```

`player` が推論済みの型に存在しないため、TypeScriptで落ちていました。

```text
Object literal may only specify known properties, and 'player' does not exist
```

## 修正内容

`rows` に明示的な型を付けました。

```ts
const rows: Array<{
  name: string;
  heightM: number;
  attack: number;
  player?: boolean;
  alive: boolean;
}> = ...
```

## 変更ファイル

```text
src/main.ts
README_FIX_ZENITH_LEADERS_TYPE.md
```

## 反映

```powershell
git add src/main.ts README_FIX_ZENITH_LEADERS_TYPE.md
git commit -m "Fix Zenith leaderboard row type"
git push
```
