import { reddit, settings } from '@devvit/web/server';
import { logger } from '../logger';
import { registerCommand } from '../trigger-modules/command';
import type { CommandEvent } from '../types';

const log = logger('define');

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_ARTICLE_BASE = 'https://en.wikipedia.org/wiki/';
const USER_AGENT = 'llmphysics-bot/1.0 (Reddit bot; r/llmphysics)';
const EXTRACT_MAX_CHARS = 600;
const GEMINI_PRIMARY_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';
const GEMINI_FALLBACK_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

// ─── Types ────────────────────────────────────────────────────────────────────

type WikiPage = {
  pageid: number;
  title: string;
  extract: string;
};

// ─── Gemini term resolver ─────────────────────────────────────────────────────

async function geminiResolve(term: string, apiKey: string): Promise<string | null> {
  const prompt =
    `You are a Wikipedia title resolver for a physics/mathematics/AI subreddit.\n` +
    `Given a user's search term, identify the exact Wikipedia article title for that concept.\n` +
    `CRITICAL: If the term is ambiguous, YOU MUST prioritize the article specifically related to ` +
    `physics, mathematics, or artificial intelligence. Look for titles that include scientific ` +
    `disambiguations (e.g., return "Observer effect (physics)" instead of "Observer effect").\n` +
    `Correct any spelling errors and use proper Wikipedia title formatting (e.g. diacritics, capitalisation).\n` +
    `If the term is not a physics, mathematics, or AI concept, reply with exactly "none".\n` +
    `Reply with only the Wikipedia article title or "none" — nothing else.\n\n` +
    `Term: ${term}`;

  const requestOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 40, temperature: 0 },
    }),
  };

  let res = await fetch(GEMINI_PRIMARY_API, requestOptions);

  // Fallback logic: If 2.5 is rate limited (429), try 3.1
  if (res.status === 429) {
    log.info('Gemini 2.5 RPD limit reached, falling back to 3.1');
    res = await fetch(GEMINI_FALLBACK_API, requestOptions);
  }

  if (!res.ok) throw new Error(`Gemini API ${res.status}`);
  
  const data = await res.json() as any;
  
  // Check if grounding was actually used for debugging/testing
  if (data.candidates?.[0]?.groundingMetadata) {
    log.info('Search grounding used for resolution', { term });
  }

  const rawResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawResult) {
    log.warn('Gemini returned no content', { term });
    return null;
  }

  const result = rawResult.trim();
  return result.toLowerCase() === 'none' || result === '' ? null : result;
}

// ─── Wikipedia API ────────────────────────────────────────────────────────────

async function fetchPageByTitle(title: string): Promise<WikiPage | null> {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'extracts',
    exintro: 'true',
    explaintext: 'true',
    redirects: '1',
    format: 'json',
    origin: '*',
  });
  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Wikipedia fetch failed: ${res.status}`);
  const data = await res.json() as {
    query: {
      pages: Record<string, {
        pageid: number;
        title: string;
        extract?: string;
        missing?: string;
      }>;
    };
  };
  const page = Object.values(data.query.pages)[0];
  if (!page || 'missing' in page) return null;
  return { pageid: page.pageid, title: page.title, extract: page.extract ?? '' };
}

// ─── Reply helpers ────────────────────────────────────────────────────────────

function articleUrl(title: string): string {
  return `${WIKI_ARTICLE_BASE}${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function truncate(text: string): string {
  if (text.length <= EXTRACT_MAX_CHARS) return text;
  const cut = text.slice(0, EXTRACT_MAX_CHARS);
  const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return lastSentence > EXTRACT_MAX_CHARS * 0.5
    ? cut.slice(0, lastSentence + 1)
    : cut.trimEnd() + '…';
}

// ─── Command handler ──────────────────────────────────────────────────────────

registerCommand(
  { commandName: 'define', contentType: 'comment', requiresArgument: true },
  async (event: CommandEvent, argument: string | null) => {
    if (!('comment' in event) || !event.comment) return;
    const term = argument!;
    const commentId = event.comment.id as `t1_${string}`;

    log.info('Looking up definition', { term });

    const apiKey = (await settings.get<string>('geminiApiKey')) || undefined;
    if (!apiKey) {
      log.warn('Gemini API key not configured');
      return;
    }

    let replyText: string;
    try {
      const canonicalTitle = await geminiResolve(term, apiKey);
      log.info('Gemini resolved term', { term, canonicalTitle });

      if (!canonicalTitle) {
        replyText = `"${term}" doesn't appear to be a physics, mathematics, or AI concept.`;
      } else {
        const page = await fetchPageByTitle(canonicalTitle);
        if (page) {
          replyText = `**${page.title}**\n[Wikipedia](${articleUrl(page.title)})\n\n${truncate(page.extract)}`;
        } else {
          replyText = `Couldn't find a Wikipedia article for "${canonicalTitle}".`;
        }
      }
    } catch (err) {
      log.error('Define command error', err, { term });
      replyText = `Failed to look up "${term}" — please try again later.`;
    }

    const comment = await reddit.getCommentById(commentId);
    await comment.reply({ text: replyText });
    log.info('Definition reply posted', { term, commentId });
  },
);
