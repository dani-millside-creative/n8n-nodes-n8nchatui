import { timingSafeEqual } from 'node:crypto';

import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

// The request body is attacker-controlled and untyped: a JSON payload can put a
// number, object, or null anywhere a string is expected. TypeScript's `as string`
// is erased at runtime, so every value pulled off the body is narrowed here first —
// otherwise e.g. `Buffer.from(12345)` throws and turns a malformed request into an
// unhandled 500.
function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

// Plain JSON objects only — arrays and null are typeof 'object' too.
function asObject(value: unknown): IDataObject | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}
	return value as IDataObject;
}

// Constant-time string compare: `crypto.timingSafeEqual` requires equal-length
// buffers, so on a length mismatch we still run a same-length compare against
// itself before failing, rather than returning early (which would leak the
// length difference through response timing).
//
// An empty `expected` (Widget Secret left unconfigured) always fails, even
// against an empty/missing `provided` value — otherwise a workflow saved
// (not necessarily activated — e.g. a listening test-webhook run) with a
// blank secret would accept any request that sends no secret at all.
function secretsMatch(provided: string, expected: string): boolean {
	if (expected.length === 0) {
		return false;
	}

	const providedBuffer = Buffer.from(provided, 'utf8');
	const expectedBuffer = Buffer.from(expected, 'utf8');

	if (providedBuffer.length !== expectedBuffer.length) {
		timingSafeEqual(providedBuffer, providedBuffer);
		return false;
	}

	return timingSafeEqual(providedBuffer, expectedBuffer);
}

export class N8nChatUiTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'n8nChatUI Trigger',
		name: 'n8nChatUiTrigger',
		icon: { light: 'file:n8nchatui.svg', dark: 'file:n8nchatui.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["responseMode"] === "onReceived" ? "Immediately" : "Using Respond Node"}}',
		description: 'Starts a workflow when the n8nChatUI widget sends a chat message',
		defaults: {
			name: 'n8nChatUI Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: '={{$parameter["responseMode"]}}',
				path: 'n8nchatui',
			},
		],
		properties: [
			{
				displayName: 'Widget Secret',
				name: 'secret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				required: true,
				description: 'Must match the secret configured in the n8nChatUI widget builder',
			},
			{
				displayName: 'Respond',
				name: 'responseMode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Immediately',
						value: 'onReceived',
						description: 'Respond as soon as this node executes',
					},
					{
						name: "Using 'Respond to n8nChatUI' Node",
						value: 'responseNode',
						description: 'Respond later using the n8nChatUI node',
					},
				],
				default: 'responseNode',
				description: 'When and how to respond to the webhook',
			},
		],
	};

	// This webhook has nothing to register with a third-party service — n8n owns
	// registration of the HTTP route itself — so the lifecycle methods are no-ops.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData();
		const secret = asString(this.getNodeParameter('secret')) ?? '';
		const responseMode = this.getNodeParameter('responseMode') as string;

		const metadata = asObject(bodyData.metadata) ?? {};
		// A non-string secret in either position is treated as absent, so it fails the
		// check below rather than reaching `Buffer.from` and throwing.
		const providedSecret =
			asString(metadata.webhook_secret) ?? asString(bodyData.webhook_secret) ?? '';

		if (!secretsMatch(providedSecret, secret)) {
			const response = this.getResponseObject();
			response.status(401).json({
				output: 'Sorry, something went wrong. Please try again later.',
			});
			return { noWebhookResponse: true };
		}

		// Non-string `chatInput`/`message` yields an empty message rather than passing a
		// number or object downstream under a field the output contract types as a string.
		const message = asString(bodyData.chatInput) ?? asString(bodyData.message) ?? '';

		// Strip the secret out of the metadata forwarded downstream — it authenticates
		// the request and has no reason to sit in execution data or be echoed back by
		// a naive `{{$json.metadata}}` reference in the workflow.
		const forwardedMetadata = { ...metadata };
		delete forwardedMetadata.webhook_secret;

		const returnItem: INodeExecutionData = {
			json: {
				message,
				sessionId: bodyData.sessionId,
				pageUrl: metadata.page_url,
				metadata: forwardedMetadata,
			},
		};

		if (responseMode === 'onReceived') {
			// An empty `webhookResponse: {}` is silently misread by n8n's default
			// response-data computation and sends back the literal string
			// "firstEntryJson" as the body instead of an ack. Send the ack directly
			// via the response object instead, matching the 401 path above.
			const response = this.getResponseObject();
			response.status(200).json({});
			return {
				workflowData: [[returnItem]],
				noWebhookResponse: true,
			};
		}

		return {
			workflowData: [[returnItem]],
		};
	}
}
