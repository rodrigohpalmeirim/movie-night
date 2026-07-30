/**
 * Light in-memory rate limiting.
 *
 * app-spec: "Light rate limiting on unauthenticated surfaces (group creation,
 * TMDB search proxy)." A fixed window in a Map is the right size of solution for
 * one small Bun server: the goal is to stop a script hammering the TMDB proxy or
 * filling the disk with empty groups, not to defend against a distributed
 * attacker. Nothing about it needs to survive a restart.
 */

export interface RateLimitVerdict {
	allowed: boolean;
	/** Requests left in the current window. */
	remaining: number;
	/** Epoch ms when the current window ends. */
	resetAt: number;
}

interface Window {
	count: number;
	resetAt: number;
}

export class RateLimiter {
	#windows = new Map<string, Window>();

	constructor(
		readonly limit: number,
		readonly windowMs: number
	) {}

	check(key: string, now = Date.now()): RateLimitVerdict {
		const existing = this.#windows.get(key);
		if (!existing || existing.resetAt <= now) {
			const fresh = { count: 1, resetAt: now + this.windowMs };
			this.#windows.set(key, fresh);
			this.#sweep(now);
			return { allowed: true, remaining: this.limit - 1, resetAt: fresh.resetAt };
		}
		if (existing.count >= this.limit) {
			return { allowed: false, remaining: 0, resetAt: existing.resetAt };
		}
		existing.count++;
		return { allowed: true, remaining: this.limit - existing.count, resetAt: existing.resetAt };
	}

	reset(): void {
		this.#windows.clear();
	}

	/** Drops expired windows so the Map cannot grow without bound. */
	#sweep(now: number): void {
		if (this.#windows.size < 512) return;
		for (const [key, window] of this.#windows) {
			if (window.resetAt <= now) this.#windows.delete(key);
		}
	}
}

/** Group creation: 5 per hour per IP. Creating a group is cheap but permanent. */
export const createGroupLimiter = new RateLimiter(5, 60 * 60 * 1000);

/** TMDB search proxy: 30 per minute per IP — well inside TMDB's free tier. */
export const tmdbSearchLimiter = new RateLimiter(30, 60 * 1000);

/**
 * Suggesting spends a TMDB *detail* call per request, so it needs its own bucket:
 * search was limited and suggest was not, which left the cheaper-to-abuse path
 * wide open. Higher than a human needs, low enough to stop a script.
 */
export const suggestLimiter = new RateLimiter(20, 60 * 1000);
