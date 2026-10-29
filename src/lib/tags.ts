/**
 * Tags on films, and the themes a night can be played under.
 *
 * A tag is a free-form, group-scoped label any member can put on a film
 * ("Halloween", "Sci-fi", "Ana's birthday"). A round may name ONE of them as its
 * theme, and a themed round only deals films that carry it (voting-spec,
 * Eligibility). Everything here is plain data and string arithmetic, shared by the
 * services, the screens and the tests — which is also why it imports nothing.
 *
 * TWO SPELLINGS PER TAG. The `key` is what identity is decided on: trimmed,
 * whitespace collapsed, case folded, so "halloween", " Halloween " and
 * "HALLOWEEN" are one tag and can never sit on a film twice. The `label` is what
 * people read, kept as somebody first typed it. That is exactly the display-name
 * convention (`members_group_display_name_unique` folds, the row keeps its
 * casing), down to the fold itself: ASCII only, because SQLite's `lower()` is
 * ASCII only and the database checks that a stored key is already folded — the
 * two must never disagree about what "the same tag" means.
 */

export interface TagRef {
	/** Folded identity: trimmed, single-spaced, ASCII-lowercased. */
	key: string;
	/** As people read it — the group's first spelling, or the preset's. */
	label: string;
}

/** Long enough for "Ana's birthday pick", short enough to sit on a chip. */
export const MAX_TAG_LENGTH = 32;

/**
 * The two themes the app knows something about. They are offered in every tag
 * picker and every theme picker even before any film carries them, and they are
 * the only themes that repaint the table (see `themePalette`). Any other tag is
 * just as valid as a theme; it simply gets its label and no palette.
 */
export const PRESET_TAGS: readonly TagRef[] = [
	{ key: 'halloween', label: 'Halloween' },
	{ key: 'christmas', label: 'Christmas' }
];

/** Trim and collapse whitespace; `null` for nothing, or for too much. */
export function cleanTagLabel(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const cleaned = raw.trim().replace(/\s+/g, ' ');
	if (cleaned.length === 0 || cleaned.length > MAX_TAG_LENGTH) return null;
	return cleaned;
}

/**
 * The fold. ASCII-only on purpose — see the file header: it has to agree with
 * SQLite's `lower()` byte for byte, or the database's "key is folded" CHECK would
 * refuse a key this function produced.
 */
export function tagKey(label: string): string {
	return label
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** The preset a key names, if it names one. */
export function presetTag(key: string): TagRef | undefined {
	return PRESET_TAGS.find((preset) => preset.key === key);
}

/**
 * Which painted table a theme gets. Presets only: a custom tag is somebody's own
 * words, and the app has no business guessing what colour "Ana's birthday" is.
 */
export type ThemePalette = 'halloween' | 'christmas';

export function themePalette(key: string | null | undefined): ThemePalette | null {
	return key === 'halloween' || key === 'christmas' ? key : null;
}

/**
 * "Themed films first" for the swipe stack during a themed OPEN round. Stable:
 * within each half the deck keeps the order it was dealt in (oldest first), so
 * theming changes which cards come up first and nothing else about the deck.
 */
export function themedFirst<T extends { tags: readonly TagRef[] }>(
	cards: readonly T[],
	themeKey: string | null | undefined
): T[] {
	if (!themeKey) return [...cards];
	const carries = (card: T) => card.tags.some((tag) => tag.key === themeKey);
	return [...cards.filter(carries), ...cards.filter((card) => !carries(card))];
}

/** "6 Halloween films", "1 Sci-fi film" — the count printed on the round screen. */
export function themedFilmCount(count: number, label: string): string {
	return `${count} ${label} ${count === 1 ? 'film' : 'films'}`;
}
