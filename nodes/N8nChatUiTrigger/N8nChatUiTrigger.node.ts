import { timingSafeEqual } from 'node:crypto';

import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IDataObject,
	IHookFunctions,
	INodeCredentialTestResult,
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
// An empty `expected` always fails, even against an empty/missing `provided`
// value — otherwise a credential saved with a blank user/password would accept
// a request that sends no credentials at all.
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

// Parses a `Basic <base64>` Authorization header into "user:password". Returns
// undefined for anything malformed rather than throwing — an attacker-supplied
// header must fail closed (401), never crash the request (see bug #6 in README).
function parseBasicAuthHeader(headerValue: unknown): string | undefined {
	if (typeof headerValue !== 'string') {
		return undefined;
	}
	const match = /^Basic\s+(.+)$/i.exec(headerValue.trim());
	if (!match) {
		return undefined;
	}
	try {
		return Buffer.from(match[1], 'base64').toString('utf8');
	} catch {
		return undefined;
	}
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
		// Only Basic Auth and None are supported — these are the two of the widget
		// builder's three "Configure Authentication For Your Webhook" options (the
		// third, JWT Auth, isn't implemented; see README "Open items"). There is no
		// body-embedded-secret option any more: the widget builder has no field for
		// one, so that design (v1's original "Widget Secret") could never actually be
		// satisfied by the real product.
		credentials: [
			{
				name: 'n8nChatUiTriggerAuthApi',
				required: true,
				testedBy: 'testN8nChatUiTriggerAuth',
				displayOptions: {
					show: {
						authentication: ['basicAuth'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Basic Auth', value: 'basicAuth' },
					{ name: 'None', value: 'none' },
				],
				default: 'basicAuth',
				description:
					'Must match the "Configure Authentication For Your Webhook" setting in the n8nChatUI widget builder',
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

	// There's no external system to verify this credential against — it isn't used
	// for an outbound call, only compared locally against whatever the n8nChatUI
	// widget sends. This just checks both fields were actually filled in.
	methods = {
		credentialTest: {
			async testN8nChatUiTriggerAuth(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const data = credential.data as { user?: string; password?: string } | undefined;
				if (!data?.user || !data?.password) {
					return { status: 'Error', message: 'Both User and Password are required' };
				}
				return {
					status: 'OK',
					message:
						"Both fields are set. There's no live n8nChatUI system to verify them against — this must match what you configure in the widget builder's Basic Auth setting.",
				};
			},
		},
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
		const authentication = this.getNodeParameter('authentication') as string;

		if (authentication === 'basicAuth') {
			// Any failure here — missing/malformed header, missing credential, wrong
			// user/password — fails closed to the same generic 401. Catching
			// `getCredentials` also stops a misconfigured node (no credential attached)
			// from surfacing as a 500 with internal detail to an unauthenticated caller.
			let authorized = false;
			try {
				const headerData = this.getHeaderData();
				const provided = parseBasicAuthHeader(headerData.authorization);
				if (provided !== undefined) {
					const credentials = (await this.getCredentials('n8nChatUiTriggerAuthApi')) as {
						user: string;
						password: string;
					};
					const expected = `${asString(credentials.user) ?? ''}:${asString(credentials.password) ?? ''}`;
					authorized = secretsMatch(provided, expected);
				}
			} catch {
				authorized = false;
			}

			if (!authorized) {
				const response = this.getResponseObject();
				response.status(401).json({
					output: 'Sorry, something went wrong. Please try again later.',
				});
				return { noWebhookResponse: true };
			}
		}

		const bodyData = this.getBodyData();
		const responseMode = this.getNodeParameter('responseMode') as string;

		const metadata = asObject(bodyData.metadata) ?? {};
		// Non-string `chatInput`/`message` yields an empty message rather than passing a
		// number or object downstream under a field the output contract types as a string.
		const message = asString(bodyData.chatInput) ?? asString(bodyData.message) ?? '';

		const returnItem: INodeExecutionData = {
			json: {
				message,
				sessionId: bodyData.sessionId,
				pageUrl: metadata.page_url,
				metadata,
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
