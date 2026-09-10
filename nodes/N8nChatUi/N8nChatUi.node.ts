import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface SuggestedRepliesCollection {
	reply?: Array<{ text?: unknown }>;
}

const MAX_SUGGESTED_REPLIES = 4;

// Reply text is expression-capable, so it can resolve to a number, null, or an
// object at runtime regardless of the declared `string` property type. Coerce the
// scalar cases (a number reply like "1" is legitimate) and drop everything else,
// so a bad expression can't put `[object Object]` or a crash into the response.
function toReplyText(value: unknown): string | undefined {
	if (typeof value === 'string') return value.trim() === '' ? undefined : value;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value === 'boolean') return String(value);
	return undefined;
}

// `output` is typed as a string in the widget envelope, but Text is expression-capable
// and commonly bound to an AI Agent's output, which can resolve to a non-string.
// Objects/arrays are JSON-encoded rather than becoming "[object Object]".
function toOutputText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value);
		} catch {
			return '';
		}
	}
	return String(value);
}

// A boolean property can still arrive as the string "false" through an expression,
// which is truthy under a plain `Boolean()` cast.
function toBoolean(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') return value.toLowerCase() === 'true';
	return Boolean(value);
}

export class N8nChatUi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'n8nChatUI',
		name: 'n8nChatUi',
		icon: { light: 'file:n8nchatui.svg', dark: 'file:n8nchatui.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send a response back to the n8nChatUI widget',
		defaults: {
			name: 'n8nChatUI',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		// Not consumed by the v1 "Message > Respond" operation — declared for forward
		// compatibility with future operations that will need it (see README).
		credentials: [
			{
				name: 'n8nChatUiApi',
				required: false,
			},
		],
		// Explicitly present but left unset (not `true`): this node replies on the pending
		// webhook response of the current execution, which isn't something an AI agent can
		// call generically, and this package must not opt into the AI-tool picker.
		usableAsTool: undefined,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Message', value: 'message' }],
				default: 'message',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				options: [
					{
						name: 'Respond',
						value: 'respond',
						description: "Send a reply back to the widget's pending chat request",
						action: 'Respond to a message',
					},
				],
				default: 'respond',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['respond'],
					},
				},
				description: 'The reply text sent back to the widget',
			},
			{
				displayName: 'Render HTML',
				name: 'renderHtml',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['respond'],
					},
				},
				description: 'Whether the widget should render Text as HTML instead of plain text',
			},
			{
				displayName: 'Suggested Replies',
				name: 'suggestedReplies',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
					multipleValueButtonText: 'Add Reply',
				},
				default: {},
				placeholder: 'Add Reply',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['respond'],
					},
				},
				description: `Up to ${MAX_SUGGESTED_REPLIES} quick-reply buttons shown to the visitor`,
				options: [
					{
						name: 'reply',
						displayName: 'Reply',
						values: [
							{
								displayName: 'Text',
								name: 'text',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
		],
	};

	// A webhook can only be responded to once. Like core's "Respond to Webhook" node,
	// this always reads parameters from item 0 and calls `sendResponse` exactly once,
	// regardless of how many input items arrive — looping per item and responding
	// per item would mean every call after the first races an already-answered
	// connection.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		try {
			const text = toOutputText(this.getNodeParameter('text', 0));
			const renderHtml = toBoolean(this.getNodeParameter('renderHtml', 0));
			const suggestedReplies = this.getNodeParameter(
				'suggestedReplies',
				0,
				{},
			) as SuggestedRepliesCollection;

			const replyEntries = suggestedReplies.reply ?? [];
			if (replyEntries.length > MAX_SUGGESTED_REPLIES) {
				throw new NodeOperationError(
					this.getNode(),
					`A maximum of ${MAX_SUGGESTED_REPLIES} suggested replies is supported`,
					{ itemIndex: 0 },
				);
			}

			// TODO: confirm against embed.js — the `output` / `renderHtml` / `quickReplies`
			// envelope keys are inferred from the existing recipe's response shape and the
			// widget builder's "Render HTML in Bot Responses" toggle, not confirmed against
			// the widget frontend's actual parser. See README "Open items".
			const envelope: IDataObject = {
				output: text,
				renderHtml,
			};

			const quickReplies = replyEntries
				.map((entry) => toReplyText(entry?.text))
				.filter((entry): entry is string => entry !== undefined);
			if (quickReplies.length > 0) {
				envelope.quickReplies = quickReplies;
			}

			// `sendResponse` needs the full HTTP response wrapper — passing the envelope
			// directly as the body is silently accepted but sends an empty response.
			await this.sendResponse({
				body: envelope,
				headers: {},
				statusCode: 200,
			});

			return [[{ json: envelope, pairedItem: { item: 0 } }]];
		} catch (error) {
			if (this.continueOnFail()) {
				return [[{ json: { error: (error as Error).message }, pairedItem: { item: 0 } }]];
			}

			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: 0 });
		}
	}
}
