/**
 * @local/html-embed — Client half.
 *
 * Registers one Conversation event Definition ("html-preview") that folds
 * finalized `assistant/message` events, extracts fenced ```html code blocks,
 * and publishes a Chat node anchored right after the assistant message; plus
 * the matching keyed `conversation.chat.node` renderer that draws each block
 * as a sandboxed iframe preview card inside the chat flow.
 *
 * Security follows the shipped Sidebar document preview: the iframe renders
 * with an empty sandbox token (scripts blocked, opaque origin) unless the
 * deployment explicitly enables `allowScripts` through the page override.
 */
window.__ModuleLoader__.load({
	id: "@local/html-embed",
	factory(require) {
		const React = require("react");
		const { createElement: h, memo, useState } = React;

		const NS = "html-embed";
		const KIND = "html-preview";
		/** Fractional anchor between the closing Assistant (.0) and the max-tokens notice (.05). */
		const ANCHOR_OFFSET = 0.03;
		const MAX_PREVIEW_BYTES = 200000;

		const DEFAULTS = {
			/** Fence info-string languages that render a preview. */
			langs: ["html", "htm"],
			/** Maximum preview cards per assistant message. */
			maxBlocks: 4,
			/** Default iframe height in px. */
			height: 280,
			/** Run scripts inside the sandbox (still opaque-origin, no host access). */
			allowScripts: false,
			/** Start cards collapsed. */
			collapsed: false
		};

		/** Page-level override; read once at activation. */
		function readOptions() {
			const override = (typeof window !== "undefined" && window.__DSH_HTML_EMBED_CONFIG__) || {};
			const merged = { ...DEFAULTS, ...override };
			if (!Array.isArray(merged.langs) || merged.langs.length === 0) merged.langs = DEFAULTS.langs;
			merged.langs = merged.langs.map((lang) => String(lang).toLowerCase());
			const height = Number(merged.height);
			merged.height = Number.isFinite(height) && height >= 80 && height <= 2000 ? Math.round(height) : DEFAULTS.height;
			const maxBlocks = Number(merged.maxBlocks);
			merged.maxBlocks = Number.isFinite(maxBlocks) && maxBlocks >= 1 && maxBlocks <= 20 ? Math.round(maxBlocks) : DEFAULTS.maxBlocks;
			merged.allowScripts = merged.allowScripts === true;
			merged.collapsed = merged.collapsed === true;
			return merged;
		}
		const OPTIONS = readOptions();

		/** Concatenate the text of finalized Assistant content blocks. */
		function assistantTextOf(content) {
			if (typeof content === "string") return content;
			if (!Array.isArray(content)) return "";
			let out = "";
			for (const block of content) {
				if (typeof block === "string") {
					out += block;
					continue;
				}
				if (block === null || typeof block !== "object") continue;
				if ((block.type === "text" || block.kind === "text") && typeof (block.text ?? block.content) === "string") {
					out += block.text ?? block.content;
				}
			}
			return out;
		}

		/**
		 * Extract fenced code blocks whose info string starts with a preview
		 * language. Line-based so indented fences, ~~~ fences, longer fences,
		 * and titles (`title="..."` or trailing text) all behave like CommonMark.
		 */
		function extractHtmlBlocks(markdown) {
			const langs = new Set(OPTIONS.langs);
			const out = [];
			const lines = String(markdown).split("\n");
			const closeCache = new Map();
			for (let i = 0; i < lines.length; i++) {
				const open = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/.exec(lines[i]);
				if (open === null) continue;
				const fence = open[1];
				const info = open[2].trim();
				const lang = info.split(/\s+/)[0].toLowerCase().replace(/^\./, "");
				if (!langs.has(lang)) continue;
				const closeRe = closeCache.get(fence) ?? closeCache.set(fence, new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`)).get(fence);
				const body = [];
				let j = i + 1;
				let closed = false;
				for (; j < lines.length; j++) {
					if (closeRe.test(lines[j])) {
						closed = true;
						break;
					}
					body.push(lines[j]);
				}
				i = j;
				if (!closed) continue;
				const html = body.join("\n");
				if (html.trim().length === 0) continue;
				const titleMatch = /\btitle\s*=\s*("([^"]*)"|'([^']*)')/.exec(info);
				let title = titleMatch !== null ? (titleMatch[2] ?? titleMatch[3]) : "";
				if (title === "" && info.length > lang.length) {
					const rest = info.slice(info.toLowerCase().indexOf(lang) + lang.length).trim().replace(/^title\s*=\s*/, "");
					if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) rest = rest.slice(1, -1);
					title = rest;
				}
				const truncated = html.length > MAX_PREVIEW_BYTES;
				out.push({
					lang,
					title,
					truncated,
					html: truncated ? html.slice(0, MAX_PREVIEW_BYTES) : html
				});
				if (out.length >= OPTIONS.maxBlocks) break;
			}
			return out;
		}

		/** Latest assistant/message facts for one Turn/Step. */
		function messageState(event) {
			const data = event.data ?? {};
			const message = data.message ?? {};
			return {
				seq: event.seq,
				time: event.time,
				turn: data.turn,
				step: data.step,
				messageId: message.id,
				text: assistantTextOf(message.content)
			};
		}

		const htmlPreviewDefinition = {
			kind: KIND,
			target: "chat",
			match: {
				"assistant/message": (event) => {
					if (event.surfaceOp !== "append") return null;
					const data = event.data;
					if (data === void 0 || data.turn === void 0 || data.step === void 0) return null;
					return {
						id: `${data.turn}:${data.step}`,
						role: "start"
					};
				}
			},
			start: (_context, match) => messageState(match.event),
			update: (_context, match) => messageState(match.event),
			publication: () => "immediate",
			buildViewNode: (context) => {
				let state = context.state;
				if (state === void 0) {
					const lastMatch = context.matches.at(-1);
					if (lastMatch !== undefined) state = messageState(lastMatch.event);
				}
				if (state === void 0 || state === null) return null;
				const items = extractHtmlBlocks(state.text);
				if (items.length === 0) return null;
				const location = context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" };
				return {
					key: context.key,
					kind: KIND,
					id: context.id,
					target: "chat",
					anchorSeq: state.seq + ANCHOR_OFFSET,
					location,
					visibility: "visible",
					groupTree: "turn",
					data: {
						seq: state.seq,
						time: state.time,
						turn: state.turn,
						step: state.step,
						messageId: state.messageId,
						items
					}
				};
			}
		};

		/** Per-node collapse memory that survives virtualization remounts. */
		const collapseMemory = new Map();

		function HtmlPreviewCard({ item, stateKey, t }) {
			const [collapsed, setCollapsed] = useState(collapseMemory.get(stateKey) ?? OPTIONS.collapsed);
			const toggle = () => {
				setCollapsed((current) => {
					const next = !current;
					if (next === OPTIONS.collapsed) collapseMemory.delete(stateKey);
					else collapseMemory.set(stateKey, next);
					return next;
				});
			};
			return h("div", { className: "htmbed-card" },
				h("div", { className: "htmbed-header" },
					h("span", { className: "htmbed-lang" }, item.lang.toUpperCase()),
					item.title !== "" ? h("span", { className: "htmbed-title", title: item.title }, item.title) : h("span", { className: "htmbed-title" }),
					item.truncated ? h("span", { className: "htmbed-truncated" }, t("truncated")) : null,
					h("button", {
						type: "button",
						className: "htmbed-toggle",
						onClick: toggle,
						"aria-expanded": String(!collapsed)
					}, t(collapsed ? "expand" : "collapse"))
				),
				collapsed ? null : h("iframe", {
					className: "htmbed-frame",
					srcDoc: item.html,
					sandbox: OPTIONS.allowScripts ? "allow-scripts" : "",
					title: t("frame"),
					loading: "lazy",
					style: { height: `${OPTIONS.height}px` }
				})
			);
		}

		const HtmlPreviewNodeView = memo(function HtmlPreviewNodeView({ node, t }) {
			const data = node?.data;
			const items = data?.items;
			if (!Array.isArray(items) || items.length === 0) return null;
			return h("div", {
				className: "htmbed-row",
				"data-html-embed": String(data.messageId ?? data.seq ?? "")
			}, items.map((item, index) => h(HtmlPreviewCard, {
				key: `${data.messageId ?? data.seq}:${index}`,
				item,
				stateKey: `${data.messageId ?? data.seq}:${index}`,
				t
			})));
		});

		const CSS = [
			".htmbed-row{padding:2px 0;flex-direction:column;gap:8px;display:flex;min-width:0}",
			".htmbed-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-base);overflow:hidden;min-width:0}",
			".htmbed-header{align-items:center;gap:8px;min-height:30px;padding:3px 8px 3px 12px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);background:var(--dsw-alias-markdown-code-block);border-bottom:.5px solid var(--dsw-alias-border-l1);display:flex}",
			".htmbed-lang{font-weight:600;letter-spacing:.05em;color:var(--dsw-alias-label-secondary);flex:none}",
			".htmbed-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}",
			".htmbed-truncated{color:var(--dsw-alias-state-warn-primary);flex:none}",
			".htmbed-toggle{background:0 0;border:0;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;padding:2px 6px;flex:none;display:inline-flex;align-items:center}",
			".htmbed-toggle:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".htmbed-toggle:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}",
			".htmbed-frame{display:block;width:100%;border:0;background:#fff;color-scheme:light}"
		].join("\n");

		const DICTS = {
			en: {
				truncated: "Preview truncated",
				collapse: "Collapse",
				expand: "Expand",
				frame: "Embedded HTML preview"
			},
			ko: {
				truncated: "미리보기 일부 생략됨",
				collapse: "접기",
				expand: "펼치기",
				frame: "임베디드 HTML 미리보기"
			},
			zh: {
				truncated: "预览已截断",
				collapse: "折叠",
				expand: "展开",
				frame: "内嵌 HTML 预览"
			}
		};

		return {
			inject: ["uiConversation", "slots", "locale"],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, DICTS), `${NS}: dictionaries`);
				ctx.effect(() => {
					const style = document.createElement("style");
					style.textContent = CSS;
					document.head.appendChild(style);
					return () => {
						style.remove();
					};
				}, `${NS}: styles`);
				ctx.effect(() => ctx.uiConversation.events.register(htmlPreviewDefinition), `${NS}: chat definition`);
				ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
					name: "conversation.chat.node",
					key: KIND,
					locale: NS
				}, HtmlPreviewNodeView));
			}
		};
	}
});
