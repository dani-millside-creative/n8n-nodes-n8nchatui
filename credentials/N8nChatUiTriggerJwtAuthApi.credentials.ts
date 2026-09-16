import type { ICredentialType, INodeProperties } from 'n8n-workflow';

// n8nChatUI's own token-signing code only ever uses HS512 (confirmed against its
// source, not assumed) — there is no algorithm to choose, so there's no field for
// one here either. See N8nChatUiTrigger.node.ts `verifyHs512Jwt` for the verifier.
export class N8nChatUiTriggerJwtAuthApi implements ICredentialType {
	name = 'n8nChatUiTriggerJwtAuthApi';

	displayName = 'n8nChatUI Trigger JWT Auth API';

	documentationUrl = 'https://n8nchatui.com/docs/';

	icon: ICredentialType['icon'] = {
		light: 'file:../nodes/N8nChatUiTrigger/n8nchatui.svg',
		dark: 'file:../nodes/N8nChatUiTrigger/n8nchatui.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'JWT Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				"Must match the secret configured in the n8nChatUI widget builder's JWT Auth setting (HS512 only)",
		},
	];
}
