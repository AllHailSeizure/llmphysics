import {
  emDashEpidemic, twoPersonWar, commentPurge, commentExplosion, depthCapSpiral, dominantEmDashContributor,
  tearMeApart, coherenceDrop, resonanceDrop, ontologyDrop, consciousnessDrop, frameworkDrop,
  cosmologicalConstantDrop, hubbleTensionDrop, toroidalDrop, fullyFalsifiableDrop, emergentDrop,
  scalarFieldDrop, tensorDrop, lean4Proof, unfinishedWorkDisclaimer,
  dunningKrugerMention, notEvenWrong, citationNeeded, whereMath, thatsAGreatQuestion,
  type CountedThread,
} from './deterministic-tiles';

export type BingoEventType = 'post_submit' | 'comment_create' | 'post_delete' | 'post_report' | 'comment_report' | 'mod_action';

export type BingoEvent = {
  type: BingoEventType;
  ts: number;
  author?: string;
  title?: string;
  body?: string;
  flair?: string;
  postId?: string;
  meta?: string;
};

export type TileValidatorDefinition = {
  valueKey: string;
  /**
   * Optional code evaluator. When present, the tile is deterministic — counted in code and
   * never sent to Gemini. When absent, the tile is semantic — judged by Gemini from
   * description / examples / edgeCaseGuidelines.
   */
  validate?: (thread: CountedThread) => boolean;
  /** Optional: when validate fires, return the username most responsible. null = community trigger. */
  attribute?: (thread: CountedThread) => string | null;
  /**
   * Optional code gate applied AFTER Gemini returns triggeredBy. Used for OP-identity tiles:
   * Gemini identifies which content triggered the tile; code verifies whether the author
   * is (or isn't) the OP, using opAuthors derived from our own event log.
   */
  postFilter?: (triggeredBy: string | null, opAuthors: Set<string>) => boolean;
  displayName?: string;
  label: string;
  gameDescription?: string;
  description: string;
  examples: string[];
  edgeCaseGuidelines: string;
  relevantTypes: BingoEventType[];
};

export const TILE_VALIDATORS: TileValidatorDefinition[] = [
  {
    valueKey: 'tear-me-apart',
    validate: tearMeApart,
    displayName: 'Tear Me Apart',
    label: 'Tear My Theory Apart',
    gameDescription: "Tear me apart, fam. Wait - are you actually gonna do it?",
    description: 'A post is submitted where the author explicitly invites harsh criticism of their theory using "tear apart" language.',
    examples: [
      'please tear this apart',
      'tear my theory apart',
      'I want this torn apart',
      'tear it apart, I can take it',
    ],
    edgeCaseGuidelines: 'Do NOT count posts that use "tear apart" in a different context (e.g. "this paper tears apart the standard model"). The phrase must be the author inviting criticism of their own work.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'coherence-drop',
    validate: coherenceDrop,
    displayName: 'Coherence',
    label: '"Coherence" in a Post',
    gameDescription: 'Do 99% of posts referencing this realize what this means in physics?',
    description: 'A post is submitted that contains the word "coherence" or "coherent".',
    examples: [
      'quantum coherence explains consciousness',
      'the coherence of spacetime fabric',
      'coherent quantum states prove my theory',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'resonance-drop',
    validate: resonanceDrop,
    displayName: 'Resonance',
    label: '"Resonance" in a Post',
    gameDescription: 'I considered making this the free square.',
    description: 'A post is submitted that contains the word "resonance" or "resonant".',
    examples: [
      'resonance fields unify gravity and electromagnetism',
      'my theory is based on quantum resonance',
      'resonant frequencies of the universe',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'ontology-drop',
    validate: ontologyDrop,
    displayName: 'Ontology',
    label: '"Ontology" in a Post',
    gameDescription: 'Why on earth are we so obsessed with this word.',
    description: 'A post is submitted that contains the word "ontology", "ontological", or "ontic".',
    examples: [
      'the ontology of quantum fields',
      'a new ontological framework for physics',
      'ontic structural realism explains my model',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'unrendered-latex',
    displayName: 'Unrendered LaTeX',
    label: 'Unrendered LaTeX in Post',
    gameDescription: 'Reddit is MD only.',
    description: 'A post is submitted containing raw LaTeX commands that will not render on Reddit.',
    examples: [
      '\\frac{E}{mc^2}',
      '\\begin{equation}',
      '\\int_{0}^{\\infty}',
      '\\nabla \\times \\mathbf{B}',
    ],
    edgeCaseGuidelines: 'Do NOT count LaTeX that appears inside a code block (backticks), as that may be intentional. Only count naked LaTeX commands in the post body.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'consciousness-drop',
    validate: consciousnessDrop,
    displayName: 'Consciousness',
    label: '"Consciousness" in a Post',
    gameDescription: 'Surely my awareness is what influences the outside world.',
    description: 'A post is submitted that contains the word "consciousness".',
    examples: [
      'consciousness is a quantum field',
      'my theory unifies consciousness and gravity',
      'the physics of consciousness explained',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'framework-drop',
    validate: frameworkDrop,
    displayName: 'Framework',
    label: '"Framework" in a Post',
    gameDescription: 'Every hypothesis can be elevated to a framework if you try hard enough.',
    description: 'A post is submitted that contains the word "framework".',
    examples: [
      'a new framework for quantum gravity',
      'my framework unifies the four forces',
      'introducing a conceptual framework for spacetime',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'cosmological-constant-drop',
    validate: cosmologicalConstantDrop,
    displayName: 'Cosmological Constant',
    label: '"Cosmological Constant" in Post',
    gameDescription: "It sounds too fancy to not engage with it, right?",
    description: 'A post is submitted that contains the phrase "cosmological constant".',
    examples: [
      'my theory resolves the cosmological constant problem',
      'the cosmological constant is evidence of a simulation',
      'reinterpreting the cosmological constant',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'hubble-tension-drop',
    validate: hubbleTensionDrop,
    displayName: 'Hubble Tension',
    label: '"Hubble Tension" in a Post',
    gameDescription: 'Hubble Tension: the gift that keeps on giving for LLM theories.',
    description: 'A post is submitted that contains the phrase "Hubble tension".',
    examples: [
      'my model solves the Hubble tension',
      'the Hubble tension proves standard cosmology is wrong',
      'a new approach to the Hubble tension',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'toroidal-drop',
    validate: toroidalDrop,
    displayName: 'Toroidal',
    label: '"Toroidal" in a Post',
    gameDescription: 'This sub loves bagels.',
    description: 'A post is submitted that contains the word "toroidal" or "toroid".',
    examples: [
      'a toroidal model of the universe',
      'toroidal magnetic field configurations explain dark energy',
      'my toroid framework for quantum gravity',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'fully-falsifiable-drop',
    validate: fullyFalsifiableDrop,
    displayName: 'Falsifiable',
    label: '"Falsifiable" in a Post',
    gameDescription: "Need legitimacy? It's the go to word.",
    description: 'A post is submitted that contains the word "falsifiable" or "falsifiability".',
    examples: [
      'my theory is falsifiable',
      'this model is falsifiable unlike string theory',
      'I want to be clear this is falsifiable',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'emergent-drop',
    validate: emergentDrop,
    displayName: 'Emergent',
    label: '"Emergent" in a Post',
    gameDescription: "Everything's gotta come from somewhere I guess.",
    description: 'A post is submitted that contains the word "emergent" or "emergence".',
    examples: [
      'gravity is an emergent phenomenon',
      'emergent properties of quantum fields explain consciousness',
      'spacetime is emergent from information',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'quarantine-discourse',
    displayName: 'Quarantine',
    label: 'Sub Is LLM Paper Quarantine',
    gameDescription: 'Ah, a fresh user, time to explain the entire purpose of the sub.',
    description: 'A comment explains that the subreddit exists as a designated space for LLM physics papers because mainstream physics subs prohibit them.',
    examples: [
      'this sub exists to keep LLM papers off of r/physics',
      'this is basically a containment sub for LLM papers',
      'most subs ban LLM papers so they end up here',
      'this sub is the quarantine zone for LLM physics content',
    ],
    edgeCaseGuidelines: "Do NOT count general meta-commentary about the sub's quality or user base. The comment must specifically be explaining that the sub's purpose is to house LLM papers excluded from other communities.",
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'explain-without-llm',
    displayName: "Don't use an LLM...",
    label: '"Explain Without an LLM"',
    gameDescription: "Use your own words. Please. I'm so sick of moderating LLM comment reports.",
    description: 'A comment asks the poster to explain their theory without using an LLM.',
    examples: [
      'can you explain this without using an LLM?',
      "try explaining that in your own words, not ChatGPT's",
      'can you describe this without AI assistance?',
      'explain it yourself, no LLM',
    ],
    edgeCaseGuidelines: 'Do NOT count comments that merely accuse a post of being LLM-generated without specifically asking for a human explanation. The comment must be requesting the OP explain it themselves.',
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'thats-a-great-question',
    validate: thatsAGreatQuestion,
    displayName: "That's a great question..",
    label: '"That\'s a Great Question"',
    gameDescription: 'Would you like me to explain the interesting history behind this tile?',
    description: 'A comment begins with "That\'s a great question" or a close variant using a positive adjective, suggesting an LLM-generated response.',
    examples: [
      "That's a great question!",
      'That is a great question.',
      "That's a really great question.",
      "That's a sharp question, let me explain...",
    ],
    edgeCaseGuidelines: 'The comment must START with the phrase. The adjective must be positive (great, sharp, valuable, excellent, etc.) — do NOT count negative or sarcastic variants like "that\'s a stupid question".',
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'dunning-kruger-mention',
    validate: dunningKrugerMention,
    displayName: 'Dunning-Kruger',
    label: 'Dunning-Kruger in Comments',
    gameDescription: 'We love psychology on this sub.',
    description: 'A comment mentions Dunning-Kruger, cognitive bias, or the "Path of Ruin" in relation to the discussion.',
    examples: [
      'this is textbook Dunning-Kruger',
      "you've never heard of the Dunning-Kruger effect?",
      'classic Dunning-Kruger right here',
      'cognitive bias is showing here',
      'path of ruin applies here',
    ],
    edgeCaseGuidelines: 'Do NOT count posts, only comments. Any mention of Dunning-Kruger (including Dunning-Krueger), cognitive bias, or path of ruin counts.',
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'not-even-wrong',
    validate: notEvenWrong,
    displayName: 'Not Even Wrong.',
    label: '"Not Even Wrong" Comment',
    gameDescription: "It's not wrong. It's not right. It's something else entirely.",
    description: 'A comment contains the phrase "not even wrong".',
    examples: [
      'this is not even wrong',
      'not even wrong, mate',
      'Pauli would say this is not even wrong',
      "not even wrong — it doesn't make a testable prediction",
    ],
    edgeCaseGuidelines: "Do NOT count posts, only comments. The phrase must appear verbatim — do not count paraphrases like \"this isn't even incorrect\".",
    relevantTypes: ['comment_create'],
  },
  /* missing-the-joke — shelved pending design (needs Humorous flair awareness + earnestness check; see GitHub issue)
  {
    valueKey: 'missing-the-joke',
    displayName: 'Missing the Joke',
    label: 'Missing the Joke',
    gameDescription: 'Marshmallow ToE? Crank.',
    description: 'A post with the "Humorous" flair receives a comment that earnestly critiques, debunks, or dismisses it as if it were a serious theory.',
    examples: [
      "you're delusional if you think this is real physics",
      'this has no mathematical basis whatsoever',
      'completely pseudoscientific, please learn the basics',
      'this violates the second law of thermodynamics',
    ],
    edgeCaseGuidelines: 'Do NOT count comments that are clearly playing along with the joke. Only count comments that are earnestly critical — Gemini should judge whether the commenter appears unaware the post is humorous. The parent post must have the Humorous flair.',
    relevantTypes: ['comment_create'],
  },
  */
  {
    valueKey: 'citation-needed',
    validate: citationNeeded,
    displayName: '[citation needed]',
    label: '"Citation Needed" Comment',
    gameDescription: '[citation needed]',
    description: 'A comment contains the phrase "citation needed".',
    examples: [
      'citation needed',
      'citation needed lol',
      '[citation needed]',
      'uh, citation needed?',
    ],
    edgeCaseGuidelines: 'Do NOT count posts, only comments. The phrase must appear verbatim or in bracket form [citation needed]. No further context filtering required.',
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'where-math',
    validate: whereMath,
    displayName: '"Where Math"',
    label: 'The "Where Math" Comment',
    gameDescription: 'Do I need to spell it out for you.',
    description: 'A comment consists entirely of the phrase "where math", with optional trailing punctuation.',
    examples: [
      'where math',
      'where math?',
      'where math.',
    ],
    edgeCaseGuidelines: 'The entire comment body must be exactly "where math", "where math?", or "where math." — nothing else. No surrounding text counts.',
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'op-cant-do-math',
    postFilter: (triggeredBy, opAuthors) => triggeredBy !== null && opAuthors.has(triggeredBy),
    displayName: "OP Can't Do the Math",
    label: "OP Admits They Can't Do the Math",
    gameDescription: "Can I do the math? No... but I know the idea is right.",
    description: 'The original poster comments on their own post admitting they do not understand or cannot do the mathematics behind their theory.',
    examples: [
      "I'm not great with the math side of this",
      "I don't really understand the equations but the concept is sound",
      'someone who knows the math could probably formalize this',
      "I can't do the math myself but I know the idea is right",
    ],
    edgeCaseGuidelines: 'Must be a comment by the OP on their own post. Do NOT count humility about advanced specific techniques — the admission must be about the foundational math behind their own theory.',
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'llms-cant-do-math',
    displayName: "LLMs Can't Do Math",
    label: '"LLMs Can\'t Do Math" Comment',
    gameDescription: "The anthem of the sub: 'LLMs can't do math!'",
    description: 'A comment claims that LLMs are incapable of doing mathematics.',
    examples: [
      "LLMs can't do math",
      'LLMs are fundamentally incapable of mathematical reasoning',
      "ChatGPT can't actually do math, it just pattern matches",
      "LLMs don't understand math they just fake it",
    ],
    edgeCaseGuidelines: "Do NOT count posts, only comments. Do NOT count nuanced discussion about LLM mathematical limitations — the comment must be making a broad claim that LLMs cannot do math.",
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'lean4-proof',
    validate: lean4Proof,
    displayName: 'Lean 4 Proof',
    label: 'Lean 4 Proof as Evidence',
    gameDescription: "This can't be wrong, I verified it in Lean 4..",
    description: 'A post presents a Lean 4 formal proof as concrete physical evidence or validation of a physics theory.',
    examples: [
      'I compiled this in Lean 4 which proves my model is correct',
      'here is the Lean 4 proof — this validates the theory',
      'the fact that Lean 4 accepts this proves it is physically real',
      'I formalized it in Lean 4, so the physics checks out',
    ],
    edgeCaseGuidelines: 'Do NOT count mentions of Lean 4 that are clearly discussing formal methods without claiming physical validity. The post must be explicitly treating the Lean 4 proof as evidence that the physics theory is correct.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'two-person-war',
    validate: twoPersonWar,
    displayName: 'Comment War',
    label: 'Two-Person Comment War',
    gameDescription: 'One post. 50+ comments. 75% by OP and one other user.',
    description: 'A post accumulates 50 or more comments where 75% or more of all comments are made by only two users: the OP and one other person.',
    examples: [
      'OP and one commenter exchange 40 replies out of 50 total comments',
      'a post with 60 comments, 47 of which are between OP and one detractor',
    ],
    edgeCaseGuidelines: 'Do NOT count if the 75% threshold is met by any two users other than OP — it must specifically be OP plus one other. Do NOT count deleted comments toward the total.',
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'em-dash-epidemic',
    validate: emDashEpidemic,
    attribute: dominantEmDashContributor,
    displayName: 'Em-Dash Epidemic',
    label: '40 Em-Dashes in One Post',
    gameDescription: 'A cruel twist of fate leads to a thread with more than 40 em-dashes over the course of its lifetime.',
    description: 'A post accumulates 40 or more em-dashes (—) across the post body and all its comments combined.',
    examples: [
      'a post body with 15 em-dashes and comments adding 25 more',
      'a heavily commented post where multiple LLM-generated replies each contain several em-dashes',
    ],
    edgeCaseGuidelines: 'Count em-dashes (—) only, not hyphens (-) or en-dashes (–). Count across the post body and all comments. Deleted comments do not count.',
    relevantTypes: ['post_submit', 'comment_create'],
  },
  {
    valueKey: 'unfinished-work-disclaimer',
    validate: unfinishedWorkDisclaimer,
    displayName: "This Isn't Complete..",
    label: 'Explicitly Incomplete Work',
    gameDescription: "Now, this theory isn't complete, but..",
    description: 'A post explicitly disclaims that the theory or proof presented is incomplete or unfinished.',
    examples: [
      "this isn't a finished proof",
      "this isn't a finished theory",
      'I know this is incomplete but',
      'this is just a rough draft of the idea',
      'not fully developed yet but here it is',
    ],
    edgeCaseGuidelines: "Do NOT count comments, only posts. The disclaimer must be explicit — do not count general humility like \"I might be wrong\". OP must be directly stating the work itself is unfinished or incomplete.",
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'did-you-read-your-post',
    postFilter: (triggeredBy, opAuthors) => triggeredBy !== null && !opAuthors.has(triggeredBy),
    displayName: 'Did You Read Your Post?',
    label: '"Did You Read Your Post?"',
    gameDescription: 'Did you even read this before posting? Sigh.',
    description: 'A commenter questions whether the OP actually read their own source material or understood what they posted.',
    examples: [
      'did you read this before posting?',
      'have you looked at this before posting?',
      'did you check this before submitting?',
    ],
    edgeCaseGuidelines: "Must be from a non-OP commenter directed at OP. Do NOT count OP defending themselves — that is a separate tile. Gemini should judge whether the commenter is questioning OP's familiarity with their own post.",
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'did-you-read-my-post',
    postFilter: (triggeredBy, opAuthors) => triggeredBy !== null && opAuthors.has(triggeredBy),
    displayName: 'Did You Read My Post?',
    label: '"Did You Read MY Post?"',
    gameDescription: "I can tell by your criticism you didn't even read my post, did you?",
    description: 'The OP defensively asks a critic whether they actually read the post before criticising it.',
    examples: [
      'did you read this before commenting?',
      'did you actually read my post?',
      'have you looked at it before criticising?',
    ],
    edgeCaseGuidelines: "Must be a comment by the OP on their own post directed at a critic. Do NOT count non-OP commenters asking this — that is a separate tile. Gemini should judge whether OP is defensively challenging whether their post was read.",
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'comment-purge',
    validate: commentPurge,
    displayName: 'Moderation Rampage',
    label: '7+ Comments Removed in Post',
    gameDescription: 'A post is subjected to a purge from the tyrant oppressors of the sub, who delete 7 or more comments in their crusade of censorship.',
    description: 'A single post has 7 or more comments removed via mod action.',
    examples: [
      'a heated post where mods remove 7 comments for rule violations',
      'a post devolving into personal attacks resulting in mass comment removal',
    ],
    edgeCaseGuidelines: 'Count only mod-removed comments, not user-deleted ones. All removals must be within the same post. Count accumulates over the life of the post, not in a single mod session.',
    relevantTypes: ['mod_action'],
  },
  {
    valueKey: 'scalar-field-drop',
    validate: scalarFieldDrop,
    displayName: 'Scalar Field',
    label: '"Scalar Field" in a Post',
    gameDescription: 'A less legit sounding tensor field..',
    description: 'A post is submitted that contains the phrase "scalar field".',
    examples: [
      'a scalar field unifies gravity and electromagnetism',
      'my theory introduces a new scalar field',
      'the scalar field explains dark energy',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'tensor-drop',
    validate: tensorDrop,
    displayName: 'Tensor',
    label: '"Tensor" in a Post',
    gameDescription: 'A more legit sounding scalar field.',
    description: 'A post is submitted that contains the word "tensor".',
    examples: [
      'my tensor framework unifies the four forces',
      'the stress-energy tensor proves my model',
      'a new tensor field theory of gravity',
    ],
    edgeCaseGuidelines: 'Do NOT count comments, only posts. No further context filtering required.',
    relevantTypes: ['post_submit'],
  },
  {
    valueKey: 'comment-explosion',
    validate: commentExplosion,
    displayName: '120 Comments',
    label: '120+ Comments on a Post',
    gameDescription: 'WTF guys?',
    description: 'A post accumulates 120 or more comments.',
    examples: [
      'a controversial theory post that spirals into a massive thread',
      'a post that attracts widespread debate across the community',
    ],
    edgeCaseGuidelines: 'Count all non-deleted comments regardless of author. No further context filtering required.',
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'xkcd-3155',
    displayName: 'XKCD 3155',
    label: 'Someone Cites XKCD 3155',
    gameDescription: 'The citation you will see 1000 times.',
    description: 'A comment cites or references XKCD comic 3155.',
    examples: [
      'xkcd.com/3155',
      'relevant xkcd: 3155',
      'have you seen xkcd 3155?',
    ],
    edgeCaseGuidelines: 'The comment must specifically reference XKCD 3155 by number or link. General XKCD references without the number do not count.',
    relevantTypes: ['comment_create'],
  },
  {
    valueKey: 'is-op-qualified',
    postFilter: (triggeredBy, opAuthors) => triggeredBy !== null && !opAuthors.has(triggeredBy),
    displayName: 'OP = Physicist?',
    label: 'OP = Physicist?',
    gameDescription: "The gatekeeper's go-to weapon.",
    description: 'A non-OP commenter questions whether the original poster has any physics education or credentials.',
    examples: [
      'did you study physics?',
      'do you have a physics education?',
      'are you a physicist?',
      'what is your physics background?',
    ],
    edgeCaseGuidelines: "Must be from a non-OP commenter directed at OP. Do NOT count OP defending their credentials. The question must be about physics education or qualifications specifically.",
    relevantTypes: ['comment_create'],
  },
];
