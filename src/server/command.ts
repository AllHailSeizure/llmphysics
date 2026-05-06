import type {
  CommentCreateHandler,
  PostSubmitHandler,
  CommandDefinition,
  CommandHandler,
  CommandEvent,
  RegisteredCommand,
} from './types';
import { logger } from './logger';

const log = logger('command');

const commands = new Map<string, RegisteredCommand>();

export function registerCommand(definition: CommandDefinition, handler: CommandHandler): void {
  if (commands.has(definition.commandName)) {
    log.warn(`Duplicate command registration: ${definition.commandName}`);
  }
  commands.set(definition.commandName, { definition, handler });
}

const BOT_MENTION = 'u/LLMPhysics-bot';
const COMMAND_PATTERN = /!(\w+)(?:\s+\\?\[([^\]]+)\\?\])?/g;

async function parseAndDispatch(
  body: string,
  contentType: 'comment' | 'post',
  event: CommandEvent,
): Promise<void> {
  if (!body.toLowerCase().includes(BOT_MENTION.toLowerCase())) return;

  const matches = [...body.matchAll(COMMAND_PATTERN)];
  if (matches.length === 0) return;

  for (const [, commandName, rawArgument] of matches) {
    const argument = rawArgument?.replace(/^[^a-zA-Z0-9()]+|[^a-zA-Z0-9()]+$/g, '');
    const registered = commands.get(commandName);
    if (!registered) {
      const argPart = argument ? `, Argument: [${argument}]` : '';
      log.info(`Unknown command: !${commandName}${argPart}`);
      continue;
    }

    const { definition, handler } = registered;

    if (definition.contentType !== 'both' && definition.contentType !== contentType) {
      log.info(`Command !${commandName} not allowed in ${contentType}`);
      continue;
    }

    if (definition.requiresArgument && argument == null) {
      log.warn(`Command !${commandName} requires an argument, none provided`);
      continue;
    }

    const arg = definition.requiresArgument ? argument! : null;
    log.info(`Dispatching command: !${commandName}`, { contentType, arg });
    await handler(event, arg);
  }
}

export const runOnComment: CommentCreateHandler = async (event) => {
  await parseAndDispatch(event.comment?.body ?? '', 'comment', event);
};

export const runOnPost: PostSubmitHandler = async (event) => {
  const text = `${event.post?.title ?? ''} ${event.post?.selftext ?? ''}`;
  await parseAndDispatch(text, 'post', event);
};
