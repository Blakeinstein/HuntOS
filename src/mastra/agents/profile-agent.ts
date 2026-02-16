import type { ProfileService } from '$lib/services/services/profile';
import {
	createUpdateProfileTool,
	createGetProfileTool,
	createGetIncompleteFieldsTool
} from '../tools/profile-tools';
import { createAgent } from './create-agent';

export function createProfileAgent(profileService: ProfileService) {
	return createAgent({
		id: 'profile-agent',
		name: 'Profile Builder Agent',
		tools: {
			updateProfile: createUpdateProfileTool(profileService),
			getProfile: createGetProfileTool(profileService),
			getIncompleteFields: createGetIncompleteFieldsTool(profileService)
		}
	});
}
