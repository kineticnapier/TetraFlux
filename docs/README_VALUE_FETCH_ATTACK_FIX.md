# Value fetch fallback and ordinary attack fix

## 1. Value model JSON parse error

原因:

```text
GET /models/web_value.json
↓
ファイルが無い
↓
Cloudflare Pagesが index.html を返す
↓
res.json()
↓
Unexpected token '<'
```

修正:

```text
content-type が text/html
または本文が <!doctype / <html で始まる
↓
value: none として扱う
```

さらに placeholder として:

```text
public/models/web_value.json
```

を追加しました。

## 2. 普通消しの攻撃力を修正

通常のline clearはこうしました。

```text
Single: 0
Double: 1
Triple: 2
Quad/Tetris: 4
```

さらに、普通消しのsingle/double/tripleはcombo込みでも:

```text
攻撃 < 消したライン数
```

になるようにcapしました。

つまり:

```text
1 line: max 0 attack
2 line: max 1 attack
3 line: max 2 attack
```

なので、3ライン普通消しで5ライン飛ぶことはなくなります。

T-spin / mini / all-spin / Tetris は特殊消し扱いなので、このcapの対象外です。

## 参考

TETR.IOの正確な現行攻撃表は公式にまとまった表を見つけられませんでした。  
ただし、Tetris系対戦では「複数ライン消し・連続消し・T-spinでgarbageを送る」という仕組み自体は一般的です。今回の修正は、TETR.IO完全再現というより、TetraFluxのsandbox用に「普通消しが強すぎない」方向へ寄せたものです。

## 変更ファイル

```text
src/main.ts
src/engine/tetris.ts
public/models/web_value.json
README_VALUE_FETCH_ATTACK_FIX.md
```

## 反映

```powershell
git add src/main.ts src/engine/tetris.ts public/models/web_value.json README_VALUE_FETCH_ATTACK_FIX.md
git commit -m "Fix value info fallback and ordinary attack table"
git push
```
