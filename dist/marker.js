/** Extract case ids from title / fullTitle / tags: C412, TC-412, KIWI:412, [C412]. */
export function extractCaseIds(t) {
    const haystack = [t.fullTitle ?? "", t.title, ...(t.tags ?? [])].join(" ");
    const out = new Set();
    const re = /\b(?:C|TC|KIWI)[-_:]?(\d{2,7})\b/gi;
    let m;
    while ((m = re.exec(haystack))) {
        out.add(parseInt(m[1], 10));
    }
    return [...out];
}
