#!/usr/bin/env npx tsx
/*---------------------------------------------------------------------------------------------
 *  test-client.ts — プロキシ経由でLM Studioにリクエストを投げるテストクライアント。
 *  本体(interceptor)のコードには一切依存しない。純粋にHTTPを叩くだけ。
 *
 *  使い方:
 *    npx tsx test-client.ts                       # デフォルト: ストリーミングchat
 *    npx tsx test-client.ts models                # モデル一覧
 *    npx tsx test-client.ts chat "質問文"         # カスタムプロンプト
 *    npx tsx test-client.ts chat "質問文" --no-stream  # 非ストリーミング
 *    npx tsx test-client.ts flood 5               # 連続5リクエスト（負荷テスト）
 *--------------------------------------------------------------------------------------------*/

const PROXY = process.env.PROXY_URL || 'http://localhost:5555';

// ── Models ──────────────────────────────────────────────────────────────────

async function testModels() {
	console.log(`GET ${PROXY}/v1/models\n`);
	const res = await fetch(`${PROXY}/v1/models`);
	const json = await res.json();
	console.log(`Status: ${res.status}`);
	if (json.data) {
		console.log(`Models (${json.data.length}):`);
		for (const m of json.data) {
			console.log(`  - ${m.id}`);
		}
	} else {
		console.log(JSON.stringify(json, null, 2));
	}
}

// ── Chat (streaming) ────────────────────────────────────────────────────────

async function testChat(prompt: string, stream: boolean) {
	const body = {
		model: '', // LM Studio uses whatever is loaded
		messages: [{ role: 'user', content: prompt }],
		max_tokens: 200,
		stream,
	};

	console.log(`POST ${PROXY}/v1/chat/completions`);
	console.log(`  stream: ${stream}`);
	console.log(`  prompt: "${prompt}"\n`);

	const start = Date.now();
	const res = await fetch(`${PROXY}/v1/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	console.log(`Status: ${res.status}`);
	console.log(`Content-Type: ${res.headers.get('content-type')}\n`);

	if (stream && res.body) {
		// SSE stream
		let tokenCount = 0;
		let firstTokenAt: number | undefined;
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let fullText = '';

		process.stdout.write('Response: ');
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = decoder.decode(value, { stream: true });
			const lines = chunk.split('\n');
			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				const data = line.slice(6);
				if (data === '[DONE]') continue;
				try {
					const parsed = JSON.parse(data);
					const content = parsed.choices?.[0]?.delta?.content;
					if (content) {
						if (!firstTokenAt) firstTokenAt = Date.now();
						tokenCount++;
						fullText += content;
						process.stdout.write(content);
					}
				} catch { /* ignore */ }
			}
		}

		const elapsed = Date.now() - start;
		const genTime = firstTokenAt ? (Date.now() - firstTokenAt) / 1000 : 0;
		const tps = genTime > 0 ? tokenCount / genTime : 0;
		const latency = firstTokenAt ? firstTokenAt - start : 0;

		console.log('\n');
		console.log('── Metrics ──');
		console.log(`  Tokens:  ${tokenCount}`);
		console.log(`  Latency: ${latency}ms (TTFT)`);
		console.log(`  TPS:     ${tps.toFixed(1)}`);
		console.log(`  Total:   ${elapsed}ms`);
	} else {
		// Non-streaming
		const json = await res.json();
		const content = json.choices?.[0]?.message?.content || JSON.stringify(json, null, 2);
		console.log(`Response: ${content}`);
		console.log(`\nTotal: ${Date.now() - start}ms`);
	}
}

// ── Flood (複数リクエスト連続) ──────────────────────────────────────────────

async function testFlood(count: number) {
	console.log(`Sending ${count} sequential requests...\n`);
	for (let i = 0; i < count; i++) {
		console.log(`─── Request ${i + 1}/${count} ───`);
		await testChat(`Count to ${i + 1} in one word.`, true);
		console.log('');
	}
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] || 'chat';

switch (command) {
	case 'models':
		await testModels();
		break;
	case 'chat':
		await testChat(args[1] || 'Say hello in Japanese, one sentence.', !args.includes('--no-stream'));
		break;
	case 'flood':
		await testFlood(parseInt(args[1] || '3'));
		break;
	default:
		// 引数がコマンドでなければプロンプトとして扱う
		await testChat(args.join(' '), true);
		break;
}
