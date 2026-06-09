# Helpers Guide

Add new helpers here only when logic is needed by 2+ modules. Keep module-specific logic in the module file.

---

## log-helper.ts

```typescript
import { logger } from './log-helper';
const log = logger(MODULE.name);  // bind once at module scope

log.info('event_name', { userId, postId });   // structured data, not strings
log.warn('unexpected_state', { detail });
log.error('handler_failed', err, { context }); // err is serialised automatically
```

`logZSet(key, entry, maxEntries?)` — low-level: appends a timestamped JSON entry to a Redis sorted set and trims to `maxEntries`. Used by modules that maintain their own audit logs (e.g. saved-responses).

---

## settings-helper.ts

```typescript
import { readSetting, writeSetting, readAllSettings, formatSignature } from './settings-helper';

const enabled = await readSetting('myModule.enabled', true);   // type inferred from default
await writeSetting('myModule.maxPosts', 3);
const all = await readAllSettings();    // every key in DEFAULTS
const sig = formatSignature(raw);       // superscripts each word, prepends '---\n\n'
```

**To add a new setting:** add to `DEFAULTS` in this file, then add the UI field in `settings-registry.ts`. Key format: `<moduleName>.<settingName>`.

---

## redis-helper.ts

Post tracking and flood quota evaluation. Owned by flood-moderator.

```typescript
trackPost(userId, postId, createdAt, isModerator, isApprovedUser)
markPostDeleted(postId) / markPostModRemoved(postId) / markPostAutoRemoved(postId)
evaluateFloodStatus(userId, username, maxPosts, windowHours, ignoreSettings, currentPostId?)
```

Redis key schema (legacy — do not change; existing data depends on these exact strings):
- `flood:post:{postId}` — Hash with user/status fields
- `flood:posts` — Global sorted set, score = createdAt ms

New modules should use the standard key format: `<module>:<type>:<scope>`.

---

## command-helper.ts

Exported as `runOnPost` and `runOnComment`. Both parse `u/LLMPhysics-bot !commandName [arg]` and dispatch to registered handlers. Not called directly by command modules — they call `registerCommand()` at module scope and import themselves as side effects.

---

## When to add a new helper

Add a helper when: the same Redis operation, formatting function, or API wrapper is needed in 2+ module files. If it's only used in one module, keep it in that module file.
