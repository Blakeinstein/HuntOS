import type { ProfileService } from '$lib/services/services/profile';
import {
	createUpdateProfileTool,
	createGetProfileTool,
	createGetIncompleteFieldsTool
} from '../tools/profile-tools';
import { withToolLogging } from '../tools/with-logging';
import { createAgent } from './create-agent';

export function createProfileAgent(profileService: ProfileService) {
	return createAgent({
		id: 'profile-agent',
		name: 'Profile Builder Agent',
		tools: {
			updateProfile: withToolLogging(createUpdateProfileTool(profileService)),
			getProfile: withToolLogging(createGetProfileTool(profileService)),
			getIncompleteFields: withToolLogging(createGetIncompleteFieldsTool(profileService))
		}
	});
}
