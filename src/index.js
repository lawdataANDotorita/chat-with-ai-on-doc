/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import OpenAI from "openai";

// Define allowed origins
const ALLOWED_ORIGINS = [
	'https://lawdata.co.il',
	'https://www.lawdata.co.il',
];

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache',
	'Connection': 'keep-alive'
};

function isOriginAllowed(origin) {
	if (!origin) return false;
	return ALLOWED_ORIGINS.includes(origin);
}

export default {
	async fetch(request, env, ctx) {
		// Check origin for ALL requests including OPTIONS
		const origin = request.headers.get('Origin');
		const referer = request.headers.get('Referer');
		
		// Check Origin header first (more reliable)
		if (origin) {
			if (!isOriginAllowed(origin)) {
				return new Response('Forbidden: Invalid origin', { 
					status: 403,
					headers: { 'Content-Type': 'text/plain' }
				});
			}
		}
		// Fallback to Referer header if Origin is not present
		else if (referer) {
			try {
				const refererUrl = new URL(referer);
				const refererOrigin = `${refererUrl.protocol}//${refererUrl.hostname}`;
				if (!isOriginAllowed(refererOrigin)) {
					return new Response('Forbidden: Invalid referer', { 
						status: 403,
						headers: { 'Content-Type': 'text/plain' }
					});
				}
			} catch (e) {
				return new Response('Forbidden: Invalid referer format', { 
					status: 403,
					headers: { 'Content-Type': 'text/plain' }
				});
			}
		}
		// No origin or referer header
		else {
			return new Response('Forbidden: No origin or referer header', { 
				status: 403,
				headers: { 'Content-Type': 'text/plain' }
			});
		}

		if (request.method === 'OPTIONS') {
			return new Response(null, { 
				headers: {
					...corsHeaders,
					'Access-Control-Allow-Origin': origin || referer ? `${new URL(referer).protocol}//${new URL(referer).hostname}` : ALLOWED_ORIGINS[0]
				}
			});
		}

		let oInputs = { text: "" };
		const contentLength = request.headers.get('content-length');
		if (contentLength && parseInt(contentLength) > 0) {
			oInputs = await request.json();
		}
		const oOpenAi = new OpenAI({
			apiKey: env.OPENAI_API_KEY,
			baseURL: "https://gateway.ai.cloudflare.com/v1/1719b913db6cbf5b9e3267b924244e58/summarize-docs/openai"
		});

		const sPrompt = `
		בפרומפט הבא תקבל טקסט משפטי שאמור להיות המקור הבלעדי בו תשתמש כדי לענות על השאלות שיופיעו לאחר מכן. 
		התפקיד שלך הוא של מומחה משפטי מהמעלה הראשונה למשפט הישראלי. 
		התשובות שלך צריכות להיות קצרות וישירות תוך שימוש בטרמינולןוגיה משפטית.
		`;

		const messagesForOpenAI = [
			{ role: 'system', content: sPrompt.trim() },
			{ role: 'user', content: oInputs.text }
		];

		const oChatData=oInputs.chatData;
		if (oChatData && oChatData.arItems) {
			for (const item of oChatData.arItems) {
				if (item.role && item.content) {
					messagesForOpenAI.push({
						role: item.role,
						content: item.content
					});
				}
			}
		}

		const bufferThreshold = 10;
		let buffer = "";
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				try {
					const chatCompletion = await oOpenAi.chat.completions.create({
						model: "gpt-4.1-mini",
						messages: messagesForOpenAI,
						temperature: 0,
						presence_penalty: 0,
						frequency_penalty: 0,
						stream: true
					});

					for await (const chunk of chatCompletion) {
						const content = chunk?.choices?.[0]?.delta?.content || '';
						buffer += content;
						if (buffer.length >= bufferThreshold) {
							controller.enqueue(encoder.encode(buffer));
							buffer = '';
						}
					}
					if (buffer.length > 0) {
						controller.enqueue(encoder.encode(buffer));
					}
					controller.close();
				} catch (error) {
					console.error("Error during OpenAI streaming:", error);
					controller.error(error);
				}
			}
		});

		return new Response(stream, { headers: corsHeaders });
	}
};