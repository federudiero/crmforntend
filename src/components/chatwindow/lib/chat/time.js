export function formatTs(ts) {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    return d ? d.toLocaleString() : "";
}

const OUTSIDE_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;

function toMillisMaybe(ts) {
    if (!ts) return 0;
    if (typeof ts === "number") return ts;
    if (typeof ts?.toMillis === "function") return ts.toMillis();
    const d = Date.parse(ts);
    return Number.isFinite(d) ? d : 0;
}

export function isOutside24h(lastInboundAt) {
    const ms = toMillisMaybe(lastInboundAt);
    if (!ms) return true;
    return Date.now() - ms > OUTSIDE_MS;
}
