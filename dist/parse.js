function unescapeXml(s) {
    return s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&amp;/g, "&");
}
function xmlAttr(attrs, name) {
    const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs);
    return m ? unescapeXml(m[1]) : undefined;
}
/** Minimal JUnit XML parser — enough for CI reports. */
export function parseJunit(xml) {
    const out = [];
    const re = /<testcase\b([^>]*?)\s*(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let m;
    while ((m = re.exec(xml))) {
        const attrs = m[1] ?? "";
        const inner = m[2] ?? "";
        const name = xmlAttr(attrs, "name") ?? "unknown";
        const classname = xmlAttr(attrs, "classname");
        const time = parseFloat(xmlAttr(attrs, "time") ?? "0") || 0;
        const failure = /<failure\b([^>]*)>([\s\S]*?)<\/failure>/.exec(inner);
        const errored = /<error\b([^>]*)>([\s\S]*?)<\/error>/.exec(inner);
        const skipped = /<skipped\b/.test(inner);
        let status = "passed";
        let error;
        if (failure) {
            status = "failed";
            error = [xmlAttr(failure[1], "message"), failure[2]].filter(Boolean).join("\n").trim();
        }
        else if (errored) {
            status = "failed";
            error = [xmlAttr(errored[1], "message"), errored[2]].filter(Boolean).join("\n").trim();
        }
        else if (skipped) {
            status = "skipped";
        }
        out.push({
            title: name,
            fullTitle: classname ? `${classname} > ${name}` : name,
            file: classname || undefined,
            status,
            durationMs: Math.round(time * 1000),
            error: error || undefined,
        });
    }
    return out;
}
export function normalizeStatus(s) {
    switch ((s ?? "").toLowerCase()) {
        case "passed":
        case "pass":
        case "success":
        case "ok":
            return "passed";
        case "failed":
        case "fail":
        case "failure":
        case "error":
            return "failed";
        case "timedout":
        case "timeout":
            return "timedOut";
        case "skipped":
        case "skip":
        case "blocked":
            return "skipped";
        case "pending":
            return "pending";
        case "todo":
            return "todo";
        case "interrupted":
            return "interrupted";
        default:
            return "failed";
    }
}
export function parseResultsJson(raw) {
    let data;
    try {
        data = JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`Results are not valid JSON: ${err.message}`);
    }
    const obj = data;
    const list = Array.isArray(data) ? data : (obj.tests ?? obj.results ?? []);
    return list.map((item, i) => {
        const t = item;
        const title = String(t.title ?? t.name ?? `test #${i + 1}`);
        const fullTitle = t.fullTitle ?? t.fullName ?? t.full_name;
        const errorRaw = t.error ?? t.failure ?? t.message;
        return {
            title,
            fullTitle: typeof fullTitle === "string" ? fullTitle : undefined,
            file: typeof t.file === "string"
                ? t.file
                : typeof t.classname === "string"
                    ? t.classname
                    : undefined,
            status: normalizeStatus(typeof t.status === "string" ? t.status : undefined),
            durationMs: typeof t.durationMs === "number"
                ? t.durationMs
                : typeof t.duration === "number"
                    ? t.duration
                    : undefined,
            error: typeof errorRaw === "string" && errorRaw.trim() ? errorRaw : undefined,
            tags: Array.isArray(t.tags) ? t.tags.map(String) : undefined,
        };
    });
}
