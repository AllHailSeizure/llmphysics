import type { SettingsMenu } from './types';

const GLOBAL_SETTINGS = {
  signature: [
    {
      key: 'botSignature',
      defaultValue: 'I am a bot. This action was performed automatically. Contact the moderators if you have questions.',
      field: {
        type: 'paragraph',
        name: 'botSignature',
        label: 'Bot signature',
        helpText: 'Enter plain text — each word is auto-formatted as superscript. Leave blank for no signature.',
        required: false,
      },
    },
  ],
};

const DEPTH_CAP_SETTINGS = {
  enabled: [
    {
      key: 'depthCapModEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'depthCapModEnabled',
        label: 'Depth Cap Moderator',
        helpText: 'Enable or disable the depth cap module.',
      },
    },
  ],
  limits: [
    {
      key: 'depthCap',
      defaultValue: 10,
      field: {
        type: 'number',
        name: 'depthCap',
        label: 'Depth cap',
        helpText: 'Lock comment chains at this depth.',
        required: false,
      },
    },
  ],
  ignoreFlags: [
    {
      key: 'depthCapIgnoreModerators',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'depthCapIgnoreModerators',
        label: 'Ignore moderators (depth cap)',
        helpText: 'Do not enforce the depth cap for moderators.',
        required: false,
      },
    },
    {
      key: 'depthCapIgnoreContributors',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'depthCapIgnoreContributors',
        label: 'Ignore approved submitters (depth cap)',
        helpText: 'Do not enforce the depth cap for approved submitters.',
        required: false,
      },
    },
  ],
  response: [
    {
      key: 'depthCapResponse',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'depthCapResponse',
        label: 'Depth cap removal message',
        helpText: 'Posted when a comment reaches the maximum allowed depth.',
        required: false,
      },
    },
  ],
};

const FLOOD_SETTINGS = {
  enabled: [
    {
      key: 'floodModEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'floodModEnabled',
        label: 'Flood Moderator',
        helpText: 'Enable or disable the flood moderator module.',
      },
    },
  ],
  quota: [
    {
      key: 'floodAssistantMaxPosts',
      defaultValue: 1,
      field: {
        type: 'number',
        name: 'floodAssistantMaxPosts',
        label: 'Max posts per window',
        helpText: 'Maximum number of posts a user can make within the time window.',
        required: false,
      },
    },
    {
      key: 'floodAssistantWindowHours',
      defaultValue: 24,
      field: {
        type: 'number',
        name: 'floodAssistantWindowHours',
        label: 'Time window (hours)',
        helpText: 'Rolling time window in hours.',
        required: false,
      },
    },
  ],
  ignoreFlags: [
    {
      key: 'floodAssistantIgnoreModerators',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'floodAssistantIgnoreModerators',
        label: 'Ignore moderators',
        helpText: 'Do not run a quota for moderators.',
        required: false,
      },
    },
    {
      key: 'floodAssistantIgnoreContributors',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'floodAssistantIgnoreContributors',
        label: 'Ignore approved submitters',
        helpText: 'Do not run a quota for approved posters.',
        required: false,
      },
    },
    {
      key: 'floodAssistantIgnoreAutoRemoved',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'floodAssistantIgnoreAutoRemoved',
        label: 'Ignore bot-removed posts',
        helpText: 'Do not include posts that are removed by the bot in the quota.',
        required: false,
      },
    },
    {
      key: 'floodAssistantIgnoreRemoved',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'floodAssistantIgnoreRemoved',
        label: 'Ignore mod-removed posts',
        helpText: 'Do not include posts that are manually removed by mods in the quota.',
        required: false,
      },
    },
    {
      key: 'floodAssistantIgnoreDeleted',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'floodAssistantIgnoreDeleted',
        label: 'Ignore deleted posts',
        helpText: 'Do not include posts that are deleted by the author in the quota.',
        required: false,
      },
    },
  ],
  response: [
    {
      key: 'floodAssistantResponse',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'floodAssistantResponse',
        label: 'Flood removal message',
        helpText: 'Posted when a user exceeds their posting quota.',
        required: false,
      },
    },
  ],
};

const SELF_RESPONSE_SETTINGS = {
  enabled: [
    {
      key: 'selfResponseModEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'selfResponseModEnabled',
        label: 'Self-Response Moderator',
        helpText: 'Enable or disable the self-response moderator module.',
      },
    },
  ],
  ignoreFlags: [
    {
      key: 'selfResponseIgnoreModerators',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'selfResponseIgnoreModerators',
        label: 'Ignore moderators (self-reply)',
        helpText: 'Do not enforce the self-response rule for moderators.',
        required: false,
      },
    },
    {
      key: 'selfResponseIgnoreContributors',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'selfResponseIgnoreContributors',
        label: 'Ignore approved submitters (self-reply)',
        helpText: 'Do not enforce the self-response rule for approved submitters.',
        required: false,
      },
    },
  ],
  response: [
    {
      key: 'selfResponseResponse',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'selfResponseResponse',
        label: 'Self-response removal message',
        helpText: 'Posted when a user responds to their own post.',
        required: false,
      },
    },
  ],
};

const LENGTH_MOD_SETTINGS = {
  enabled: [
    {
      key: 'lengthModEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'lengthModEnabled',
        label: 'Length Moderator',
        helpText: 'Enable or disable the length moderator module.',
      },
    },
  ],
  limits: [
    {
      key: 'lengthModFlairId',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'lengthModFlairId',
        label: 'Flair template ID for max length posts',
        helpText: 'Flair template ID that triggers the character limit.',
        required: false,
      },
    },
    {
      key: 'lengthModMaxUnhostedLength',
      defaultValue: 0,
      field: {
        type: 'number',
        name: 'lengthModMaxUnhostedLength',
        label: 'Max unhosted length',
        helpText: 'Maximum character count for posts with the specified flair.',
        required: false,
      },
    },
    {
      key: 'lengthModMinHostedLength',
      defaultValue: 0,
      field: {
        type: 'number',
        name: 'lengthModMinHostedLength',
        label: 'Min hosted length',
        helpText: 'Minimum character count for link posts.',
        required: false,
      },
    },
  ],
  response: [
    {
      key: 'lengthModMaxUnhostedComment',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'lengthModMaxUnhostedComment',
        label: 'Max post length message',
        helpText: 'Posted when character count exceeds limit for specific flairs.',
        required: false,
      },
    },
    {
      key: 'lengthModMinHostedComment',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'lengthModMinHostedComment',
        label: 'Un-summarized link message',
        helpText: 'Posted when a link is present and character count not met.',
        required: false,
      },
    },
  ],
};

const ADVERSARIAL_REVIEWER_SETTINGS = {
  enabled: [
    {
      key: 'adversarialReviewerEnabled',
      defaultValue: false,
      field: {
        type: 'boolean',
        name: 'adversarialReviewerEnabled',
        label: 'Adversarial Reviewer',
        helpText: 'Enable the Gemini-powered adversarial physics reviewer.',
      },
    },
  ],
};

const MOP_TOOL_SETTINGS = {
  enabled: [
    {
      key: 'mopToolEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'mopToolEnabled',
        label: 'Chain Mop',
        helpText: 'Enable or disable the chain mop action.',
      },
    },
  ],
};

const RESPONSE_TOOL_SETTINGS = {
  enabled: [
    {
      key: 'responseToolEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'responseToolEnabled',
        label: 'Saved Responses',
        helpText: 'Enable or disable saved responses.',
      },
    },
  ],
};

const DEFINE_COMMAND_SETTINGS = {
  enabled: [
    {
      key: 'defineCommandEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'defineCommandEnabled',
        label: 'Define Command',
        helpText: 'Enable or disable the !define command.',
      },
    },
  ],
};

export const SETTINGS_MENUS: SettingsMenu[] = [
  {
    key: 'modules',
    label: 'Modules',
    settings: [
      ...DEPTH_CAP_SETTINGS.enabled,
      ...FLOOD_SETTINGS.enabled,
      ...SELF_RESPONSE_SETTINGS.enabled,
      ...LENGTH_MOD_SETTINGS.enabled,
      ...MOP_TOOL_SETTINGS.enabled,
      ...RESPONSE_TOOL_SETTINGS.enabled,
      ...DEFINE_COMMAND_SETTINGS.enabled,
      ...ADVERSARIAL_REVIEWER_SETTINGS.enabled,
    ],
  },
  {
    key: 'flood',
    label: 'Flood Moderator',
    settings: [...FLOOD_SETTINGS.quota, ...FLOOD_SETTINGS.ignoreFlags],
  },
  {
    key: 'commenting',
    label: 'Commenting',
    settings: [...DEPTH_CAP_SETTINGS.limits, ...DEPTH_CAP_SETTINGS.ignoreFlags, ...SELF_RESPONSE_SETTINGS.ignoreFlags],
  },
  {
    key: 'posting',
    label: 'Posting',
    settings: [...LENGTH_MOD_SETTINGS.limits],
  },
  {
    key: 'removal-messages',
    label: 'Removal Messages',
    settings: [
      ...GLOBAL_SETTINGS.signature,
      ...FLOOD_SETTINGS.response,
      ...DEPTH_CAP_SETTINGS.response,
      ...SELF_RESPONSE_SETTINGS.response,
      ...LENGTH_MOD_SETTINGS.response,
    ],
  },
];
