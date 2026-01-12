import React, { useMemo, useState } from "react";
import { EMOJI_CATEGORIES, EMOJIS } from "../lib/emojis";

const TONES = ["🏻","🏼","🏽","🏾","🏿"];

// emojis que aceptan tono
const SUPPORTS_TONE = /[\u{1F3FB}-\u{1F3FF}]|[👋🤚✋🖖👌🤌🤏✌🤞🤟🤘🤙👈👉👆🖕👇☝👍👎✊👊🤛🤜👏🙌👐🤲🙏👶👧🧒👦👩🧑👨]/u;

function applyTone(e, tone) {
  const base = e.replace(/[\u{1F3FB}-\u{1F3FF}]/u, "");
  return SUPPORTS_TONE.test(e) ? base + tone : e;
}

export default function EmojiPickerLite({ onPick, perLine = 8 }) {
  const [activeTab, setActiveTab] = useState("smileys");
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState("");
  const [recents, setRecents] = useState([]);

  const categories = useMemo(() => EMOJI_CATEGORIES, []);
  const data = useMemo(() => ({ ...EMOJIS, recent: recents }), [recents]);

  const list = useMemo(() => {
    const arr = data[activeTab] || [];
    if (!query.trim()) return arr;
    const q = query.toLowerCase();
    return arr.filter((e) => e.toLowerCase().includes(q));
  }, [data, activeTab, query]);

  const rows = useMemo(() => {
    const out = [];
    for (let i = 0; i < list.length; i += perLine) out.push(list.slice(i, i + perLine));
    return out;
  }, [list, perLine]);

  const pick = (emoji) => {
    const chosen = tone ? applyTone(emoji, tone) : emoji;
    onPick(chosen);
    setRecents((prev) => {
      const next = [chosen, ...prev.filter((e) => e !== chosen)];
      return next.slice(0, perLine * 3);
    });
  };

  return (
    <div  className="
    w-full sm:w-80 md:w-96 lg:w-[28rem]
    max-h-[60vh] overflow-y-auto
    border shadow-xl rounded-2xl bg-base-100
    fixed bottom-[70px] sm:absolute sm:bottom-auto
    sm:translate-y-[-100%] sm:mb-2
    right-2 sm:right-0
    z-50 transition-all duration-200
  ">
      {/* Buscador + tonos */}
      <div className="flex items-center gap-2 p-2 border-b">
        <input
          className="w-full input input-sm input-bordered"
          placeholder="Buscar emoji…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex items-center gap-1">
          <button
            className={`btn btn-xs ${tone === "" ? "btn-primary" : "btn-ghost"}`}
            title="Sin tono"
            onClick={() => setTone("")}
          >
            ◻️
          </button>
          {TONES.map((t) => (
            <button
              key={t}
              className={`btn btn-xs ${tone === t ? "btn-primary" : "btn-ghost"}`}
              title={`Tono ${t}`}
              onClick={() => setTone(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs de categorías */}
      <div className="flex gap-1 p-2 overflow-x-auto border-b">
        {categories.map((c) => (
          <button
            key={c.key}
            className={`btn btn-xs ${activeTab === c.key ? "btn-active" : ""}`}
            onClick={() => setActiveTab(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Grilla */}
      <div className="p-2">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${perLine}, minmax(0,1fr))` }}
        >
          {rows.map((row, i) => (
            <React.Fragment key={i}>
              {row.map((emoji) => (
                <button
                  key={`${i}-${emoji}`}
                  className="p-1 text-xl rounded hover:bg-base-200"
                  onClick={() => pick(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
        {!rows.length && (
          <div className="p-6 text-sm text-center opacity-70">
            Sin resultados.
          </div>
        )}
      </div>
    </div>
  );
}
