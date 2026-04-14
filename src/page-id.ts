/**
 * Returns a stable identifier for the current page, used as a prefix for
 * localStorage keys so that editors with the same `id` on different pages
 * don't collide.
 *
 * Strategy (in order of preference):
 *  1. <link rel="canonical"> pathname + search — the page's declared identity,
 *     works correctly for CMS systems that use query params to identify pages
 *     (e.g. DokuWiki's ?id=...) and is unaffected by fragment changes.
 *  2. location.pathname + location.search — reliable fallback for everything
 *     else; fragment excluded so anchor-link navigation doesn't orphan state.
 */
export function getPageId(): string {
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (link?.href) {
        try {
            const u = new URL(link.href);
            return u.pathname + u.search;
        } catch { /* fall through */ }
    }
    return location.pathname + location.search;
}
