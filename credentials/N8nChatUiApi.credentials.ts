import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// PLACEHOLDER — not confirmed against a real n8nChatUI API (none exists yet for v1).
// Header name/scheme, documentationUrl and test URL must be verified before this
// credential is used against anything real. See README "Open items".
export class N8nChatUiApi implements ICredentialType {
	name = 'n8nChatUiApi';

	displayName = 'n8nChatUI API';

	documentationUrl = 'https://n8nchatui.com/docs/';

	icon: ICredentialType['icon'] = {
		light: 'file:../nodes/N8nChatUiTrigger/n8nchatui.svg',
		dark: 'file:../nodes/N8nChatUiTrigger/n8nchatui.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://n8nchatui.com',
			url: '/api/v1/ping',
			method: 'GET',
		},
	};
}
