/**
 * The splash template contract.
 *
 * `ctx` already carries more than today's single template uses. That is the
 * seam for the real templates later — widening the context is a non-breaking
 * change, whereas changing the shape of `render` is not.
 */
export interface SplashContext {
  /** Where the visitor is going once the splash is done. */
  targetUrl: string;
  /** Human label for the target, when one exists. */
  label?: string;
}

export interface SplashParts {
  /** Markup for the splash stage. Inlined into the shell, never fetched. */
  html: string;
  /** Scoped CSS. Inlined. */
  css: string;
  /** Optional JS. Inlined. Must not perform the redirect itself. */
  js?: string;
  /**
   * How long the shell waits before redirecting, in ms. The shell caps this;
   * a template cannot hold a visitor hostage.
   */
  durationMs: number;
}

export interface SplashTemplate {
  id: string;
  label: string;
  render(ctx: SplashContext): SplashParts;
}
