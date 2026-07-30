/**
 * DEV_MODE — the one flag that unlocks the developer-only member switcher.
 *
 * Read from the environment on every call rather than captured at import time,
 * so a test (or a `bun --env-file` run) can flip it without reloading modules.
 *
 * Strictly opt-in: only the exact string `1` enables it. Anything else —
 * unset, empty, `0`, `true`, `yes` — leaves the app in its normal state, because
 * this flag makes it trivial to become any member of any group whose invite link
 * you hold, and a truthy-ish match is how such a flag ends up enabled in
 * production by accident.
 */
export function devModeEnabled(): boolean {
	return process.env.DEV_MODE === '1';
}
