import type { ICredentialType, INodeProperties } from 'n8n-workflow';

// Community nodes can't reference n8n's built-in `httpBasicAuth` credential —
// n8n's own lint rules forbid cross-package credential reuse — so this package
// ships its own, structurally identical (User + Password) credential for
// n8nChatUI Trigger's Basic Auth mode instead.
export class N8nChatUiTriggerAuthApi implements ICredentialType {
	name = 'n8nChatUiTriggerAuthApi';

	displayName = 'n8nChatUI Trigger Basic Auth API';

	documentationUrl = 'https://n8nchatui.com/docs/';

	icon: ICredentialType['icon'] = {
		light: 'file:../nodes/N8nChatUiTrigger/n8nchatui.svg',
		dark: 'file:../nodes/N8nChatUiTrigger/n8nchatui.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'User',
			name: 'user',
			type: 'string',
			default: '',
			description: 'Must match the username configured in the n8nChatUI widget builder\'s Basic Auth setting',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Must match the password configured in the n8nChatUI widget builder\'s Basic Auth setting',
		},
	];
}
