# Veltrea Interceptor

AIエージェントやAI関連ソフトウェアを開発していると、プロトコルの分析は避けて通れません。リクエストの中身、SSEストリーミングの生データ、レスポンスヘッダー ― これらを正確に把握しないまま開発を進めると、原因不明のバグに何時間も費やすことになります。

Veltrea Interceptor は、OpenAI互換APIの通信を透過的にキャプチャし、リアルタイムで可視化するプロキシです。自分自身のAIエージェント開発のために作りました。同じようにAIエージェントやAI関連ソフトウェアを開発している方にとって、この手のツールは欠かせないものだと思うので、役立ててもらえれば幸いです。

以前 [ai-protocol-monitor](https://github.com/veltrea/ai-protocol-monitor) という別実装を公開していましたが、作り慣れてきて違う実装を思いつき、1から作り直したのがこのプロジェクトです。

## 使い方

```
あなたのクライアント → Veltrea Interceptor → LLM サーバー
```

クライアントの接続先を Veltrea Interceptor のポート（デフォルト :5555）に向けるだけです。通信はそのまま LLM サーバーに中継され、全データがキャプチャされます。

## 何ができるか

- リクエスト/レスポンスのヘッダーとボディの閲覧（コピーボタン付き）
- SSE ストリーミングチャンクのリアルタイム表示（トークン単位 / テキスト結合 / Raw の3モード切替）
- TTFT（最初のトークンまでの遅延）、TPS（トークン/秒）、所要時間のメトリクス
- モデルロード時間を除外した純粋な推論レイテンシの計測（LM Studio の `/api/v0/models` で状態を確認）
- 新しいリクエストを自動選択して詳細表示
- OpenAI / Anthropic / Google Gemini フォーマットの自動判別
- 全データの SQLite 永続化
- MCP サーバー / CLI による AI エージェントからの直接操作
- 生ログのファイル書き出し（パーサー開発の資料作成向け）

## 起動

```bash
# デフォルト（proxy :5555 → LM Studio :1234）
./start.sh

# 上流の LLM サーバーを指定
./start.sh --upstream http://192.0.2.22:1234

# ポート変更
./start.sh --port 8080

# プロキシだけ（通信モニター・チャットクライアントなし）
./start.sh --no-client --no-dashboard
```

`start.sh` を実行すると、プロキシ、通信モニターアプリ、チャットクライアントが一括で起動します。Ctrl+C でまとめて終了します。

## ビルド

```bash
# プロキシ（Node.js）
npm install

# 通信モニター（Tauri）
cd gui && npm install && npx tauri build

# MCP サーバー / CLI
cd mcp && npm install
```

## 通信モニター

Tauri 製のネイティブアプリです。`start.sh` で自動起動します。

- **左ペイン** — リクエスト一覧。モデル名、TPS、メッセージ数、ユーザーの最後のメッセージを表示
- **中央パネル** — 選択したリクエストの詳細。ヘッダー、ボディ、レスポンス、SSEチャンク（各セクションにコピーボタン付き）
- **右パネル** — ライブストリーム。3つの表示モードを切替可能：
  - **デフォルト** — トークン単位の細切れ表示（タイムスタンプ付き）
  - **Text** — トークンをつないだ文として表示
  - **Raw** — SSE の生 JSON データを表示

## MCP サーバー

AI エージェント（Claude Code、Antigravity 等）から Veltrea Interceptor を直接操作できます。MCP サーバーはプロキシ本体とは別プロセスで、WebSocket 経由でデータを取得します。GUI ウィンドウは開きません。

ツール数は 6 個に抑えています（Antigravity のツールスロット上限を考慮）。

### セットアップ

```bash
cd mcp && npm install
```

Claude Code の設定ファイルに追加：

```json
{
  "mcpServers": {
    "veltrea-interceptor": {
      "command": "node",
      "args": ["mcp/node_modules/.bin/tsx", "mcp/server.ts"],
      "cwd": "/path/to/ai_proxy"
    }
  }
}
```

### MCP ツール

| ツール | 説明 |
|---|---|
| `get_recent_requests` | 直近のリクエスト一覧を取得 |
| `get_request_detail` | 特定リクエストの全詳細（ヘッダー、ボディ、SSEチャンク） |
| `get_raw_chunks` | SSE 生データを取得 |
| `send_chat` | プロキシ経由でテストメッセージを送信 |
| `set_model` | 上流に送るモデルを変更 |
| `set_max_tokens` | max_tokens を変更 |

## CLI

MCP をインストールしなくても、全機能をコマンドラインから利用できます。

```bash
npx tsx mcp/cli.ts <command>
```

| コマンド | 説明 |
|---|---|
| **チャット** | |
| `send [model] <message> [--max-tokens N]` | プロキシ経由でチャット送信（ストリーミング表示） |
| **データ取得** | |
| `recent [limit]` | 直近のリクエスト一覧 |
| `detail <id>` | リクエスト詳細（ヘッダー、ボディ、チャンク） |
| `chunks <id>` | SSE 生データ表示 |
| `metrics` | 集計メトリクス（TPS、レイテンシ等） |
| `search --model X --method POST --limit N` | リクエスト検索 |
| **パラメータ制御** | |
| `set-model <name>` | 上流に送るモデルを変更 |
| `set-max-tokens <n>` | max_tokens を変更 |
| `overrides` / `clear-overrides` | 現在のオーバーライド確認・解除 |
| **ログ書き出し** | |
| `dump <id> [dir]` | 特定リクエストの生ログをファイルに書き出し |
| `dump-all [dir] [--limit N]` | 全リクエストを一括書き出し |
| **UI 操作** | |
| `ui-select <id>` | 通信モニター上でリクエストを選択表示 |
| `ui-raw on\|off` | Raw 表示切替 |
| `ui-clear` | ストリームパネルクリア |
| **メンテナンス** | |
| `reset-db` | SQLite データベース削除 |

## テストフレーズ集

`docs/test-phrases.md` にモデル評価・プロトコル解析用のテストフレーズをまとめています。基本応答、コード生成、ツール呼び出し、コマンド安全性、段階的エスカレーションなど、複数カテゴリのフレーズが含まれています。

モデルに対して「あなたのプロトコルは何か」と段階的に問い詰めていくと、多くのモデルがシステムプロンプトやツール定義を自己申告してくれます。この手法を活用したフレーズも含まれています。

## 関連プロジェクト

[chat-client](https://github.com/veltrea/chat-client) — OpenAI API 互換のシンプルなネイティブチャットクライアント。Veltrea Interceptor と組み合わせると、LM Studio にロードした AI モデルのプロトコル解析がはかどります。

## 必要な環境

- Node.js 20+
- Rust / Cargo（通信モニターのビルドに必要）

## ライセンス

MIT
