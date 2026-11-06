# Chrome ウェブストア提出用メモ

Chrome Web Store デベロッパー ダッシュボード(https://chrome.google.com/webstore/devconsole)で入力する内容です。
初回のみ、デベロッパー登録料 5 ドルがかかります(登録と支払いはご自身で行ってください)。

## 提出前にやること

1. GitHub に `DelacrowLab/plamo-select-translate` リポジトリを作り、このフォルダの中身を置く(PRIVACY.md が公開される)
2. GitHub の Releases に `dist/plamo-translate-server-<版>.zip`(翻訳サーバーのセット)と
   `dist/plamo-translate-ext-<版>.zip`(個人配布用)を添付して公開する
   → 設定画面・説明書のダウンロードリンク https://github.com/DelacrowLab/plamo-select-translate/releases/latest が有効になる
3. 下の内容でストアに提出する

## アップロードするファイル

- パッケージ: `dist/plamo-translate-ext-<版>-store.zip`(`build.ps1` で作成)
- アイコン(128×128): `icons/icon128.png`
- スクリーンショット(1280×800): `store/screenshot-1.png`
- プロモーション タイル(小、440×280): `store/promo-tile-440x280.png`

## ストアの掲載情報

**カテゴリ:** 仕事効率化(Productivity)
**言語:** 日本語

**概要(132 文字以内):**
選択したテキストを、PC 上で動かす PLaMo 3 Translate ですぐに翻訳。文章は外部に送信されず、API キーも不要です。

**説明:**
```
ページ上のテキストを選択するだけで、すぐ下に翻訳を表示します。

翻訳には、Preferred Networks が公開している翻訳モデル「PLaMo 3 Translate」を、あなたの PC 上で動かして使います。初期設定では、翻訳する文章がインターネット上のサービスに送られることはありません。API キーや利用料も不要です。

■ 主な機能
・テキストを選択すると自動で翻訳(オフにして右クリックや Alt+T で翻訳することもできます)
・日本語を選ぶと英語に、それ以外は日本語に翻訳。翻訳先は 53 言語から選択可能
・入力欄の中で選んだ文章も翻訳可能
・モデルを選べます: 0.8B(速い)/ 2B(訳文が少し自然)/ 使い分け(短い語句は 0.8B、文章は 2B)
・日本語の文体(です・ます調/だ・である調)を指定可能

■ 送信するデータについて
初期設定では、テキストを選択した時点で自動的に翻訳します(設定でオフにできます)。翻訳のため、選択した文章(埋め込みフレーム内を含む)とページタイトル(設定でオフにできます)を、PC 上の翻訳サーバー(127.0.0.1)に送ります。設定で PC 以外のサーバー(https のみ)を指定した場合は、そのサーバーに送ります。翻訳した文章や結果は保存しません。

■ 使う前の準備(Windows・最初の 1 回だけ)
この拡張機能を使うには、PC 上で翻訳サーバーを動かす必要があります。
1. llama.cpp をインストール: ターミナルで「winget install llama.cpp」
2. 翻訳サーバーのセットをダウンロード:
   https://github.com/DelacrowLab/plamo-select-translate/releases/latest
3. セットの中の「自動起動を設定する.bat」を実行してモデルを選ぶ
   (以後、PC にサインインすると翻訳サーバーが裏で自動起動します。30 分使わないとメモリから下ろします)
4. 拡張機能の設定画面で「接続テスト」を押して確認
初回はモデル(0.8B で約 0.6 GB)が自動でダウンロードされます。

■ モデルのライセンス
Built with PLaMo
PLaMo 3 Translate は Preferred Networks, Inc. が PLaMo コミュニティライセンス契約のもとで提供しています。モデルはこの拡張機能に含まれておらず、利用者が各自ダウンロードします。個人での利用は無料です。商用利用には PFN への事前登録と、年間売上 10 億円以下であることが必要です。

この拡張機能は Preferred Networks, Inc. の公式製品ではありません。
```

## プライバシーへの取り組み(ダッシュボードの「プライバシー」タブ)

**単一用途の説明:**
ウェブページ上で選択したテキストを、利用者の PC 上で動く翻訳モデルで翻訳し、その場に表示します。

**権限が必要な理由:**

| 権限 | 理由(そのまま貼り付け可) |
|---|---|
| ホスト権限(すべてのサイト・すべてのフレームでのコンテンツスクリプト) | 利用者がどのウェブページ(埋め込みフレーム内を含む)でテキストを選択しても、その近くに翻訳結果を表示するために必要です。ページの内容は、利用者が選択したテキスト、ページタイトル、ページの言語設定以外は読み取りません。 |
| ホスト権限(localhost / 127.0.0.1) | 利用者の PC 上で動く翻訳サーバーに、翻訳を依頼するために必要です。 |
| storage | 翻訳サーバーの URL や翻訳先の言語などの設定を保存するために必要です。 |
| contextMenus | 右クリックメニューに「PLaMo で翻訳」を追加するために必要です。 |
| 任意のホスト権限(optional_host_permissions) | 利用者が PC 以外の翻訳サーバー(https のみ)を設定した場合に限り、そのサーバーへの接続許可を求めるために使います。既定では使用しません。 |

**リモートコードの使用:** いいえ(すべてのコードはパッケージに含まれています)

**データの使用:**
- 収集するデータ: 「ウェブサイトのコンテンツ」にチェック(選択したテキストを翻訳サーバーに送るため。初期設定の送信先は利用者自身の PC)
- 次の 3 項目すべてにチェック:
  - 承認されている用途以外の目的で第三者にユーザーデータを販売、転送しない
  - アイテムの唯一の目的と関係のない目的でユーザーデータを使用、転送しない
  - 信用度の判断や融資の目的でユーザーデータを使用、転送しない

**プライバシー ポリシーの URL:**
https://github.com/DelacrowLab/plamo-select-translate/blob/main/PRIVACY.md

**審査担当者へのメモ(「審査担当者への注記」欄など):**
```
This extension sends the selected text only to a translation server running on the user's own PC (http://127.0.0.1:8080, llama.cpp llama-server with the PLaMo 3 Translate model). Without that local server, translation shows a "cannot connect to the translation server" message by design. Setup instructions and the server kit: https://github.com/DelacrowLab/plamo-select-translate
```

## 審査で注意すること

- 名前に「PLaMo」(Preferred Networks の商標の可能性あり)を含めています。商標の扱いで指摘を受けた場合は、「選択翻訳 for PLaMo」のように、公式製品ではないとわかる名前に変えるのが無難です。
- 審査担当者は翻訳サーバーを用意しないことが多いため、「サーバーがないと動かない」ことを説明欄と注記に明記しています。
