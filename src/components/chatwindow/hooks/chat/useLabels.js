import { useEffect, useMemo, useState } from "react";
import { listLabels, PRESET_LABELS } from "../../../../lib/labels";

export default function useLabels() {
    const [allLabels, setAllLabels] = useState([]);

    useEffect(() => {
        (async () => {
            try {
                const arr = await listLabels();
                setAllLabels(arr || []);
            } catch {
                setAllLabels([]);
            }
        })();
    }, []);

    const labelBySlug = useMemo(() => {
        const map = new Map();
        for (const l of allLabels) map.set(l.slug, l);
        return map;
    }, [allLabels]);

    const getLabel = (slug) => labelBySlug.get(slug) || { name: slug, slug, color: "neutral" };

    const tagsData = useMemo(() => {
        const merged = new Map();
        for (const p of PRESET_LABELS) merged.set(p.slug, { slug: p.slug, name: p.name, count: 0 });
        for (const l of allLabels) merged.set(l.slug, { slug: l.slug, name: l.name || l.slug, count: 0 });
        return Array.from(merged.values());
    }, [allLabels]);

    return { allLabels, tagsData, getLabel };
}
