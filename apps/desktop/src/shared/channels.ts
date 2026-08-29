/**
 * The complete allow-list of IPC channels. The preload
 * bridge exposes ONLY these; anything not listed here cannot cross the boundary.
 * Request/response channels use `invoke`; streaming uses `on` event channels.
 */

export const INVOKE_CHANNELS = [
  "ai:gatewayState",
  "ai:listProviders",
  "ai:connectedAccounts",
  "ai:beginConnect",
  "ai:listModels",
  "ai:selectModel",
  "ai:selectedModel",
  "agent:list",
  "agent:createDraft",
  "agent:openDraft",
  "agent:status",
  "agent:renameDraft",
  "agent:settings",
  "agent:selectModel",
  "agent:setAccess",
  "agent:setSearchApiKey",
  "agent:setSearchProvider",
  "agent:prepareAssets",
  "agent:requestMoreAssets",
  "agent:approveAssets",
  "agent:prepareBrief",
  "agent:returnToAssets",
  "agent:approveBrief",
  "agent:createVideo",
  "agent:deleteDraft",
  "projects:create",
  "projects:pickImages",
  "projects:importImageBytes",
  "projects:removeStagedImage",
  "projects:list",
  "projects:open",
  "projects:stage",
  "projects:rename",
  "projects:delete",
  "projects:reveal",
  "projects:save",
  "projects:cancel",
  "projects:retry",
  "projects:fixWithAi",
  "projects:submitImageReview",
  "projects:diagnostics",
  "bgm:list",
  "bgm:add",
  "bgm:remove",
  "bgm:getForProject",
  "bgm:setForProject",
  "thumbnail:generate",
  "thumbnail:save",
  "script:get",
  "script:applyEdits",
  "script:approve",
  "script:setEnabled",
  "review:submitEdits",
  "review:approveDraft",
  "settings:get",
  "settings:update",
  "settings:readiness",
  "settings:renderSmoke",
  "queue:list",
  "queue:get",
  "queue:create",
  "queue:delete",
  "queue:rename",
  "queue:addJob",
  "queue:updateJob",
  "queue:deleteJob",
  "queue:cancelJob",
  "queue:start",
  "queue:pause",
  "queue:resume",
  "queue:status",
  "tts:setApiKey",
  "tts:clearApiKey",
  "tts:testVoice",
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = [
  "events:progress",
  "events:scene",
  "events:status",
  "events:friendlyError",
] as const;

export type EventChannel = (typeof EVENT_CHANNELS)[number];

export function isInvokeChannel(value: string): value is InvokeChannel {
  return (INVOKE_CHANNELS as readonly string[]).includes(value);
}
