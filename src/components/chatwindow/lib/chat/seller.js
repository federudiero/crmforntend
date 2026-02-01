const SELLER_NAME_MAP = {
    "lunacami00@gmail.com": "Camila",
    "escalantefr.p@gmail.com": "Fernando",
    "julicisneros.89@gmail.com": "Juliana",
    "christian15366@gmail.com": "Christian",
};

const prettifyLocal = (email = "") =>
    (email.split("@")[0] || "")
        .replace(/[._-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
        .join(" ");

export const getSellerDisplayName = (user = {}) => {
    const email = String(user.email || "").toLowerCase().trim();
    const alias = (user.alias || "").trim();
    const name = (user.name || "").trim();

    if (email && SELLER_NAME_MAP[email]) return SELLER_NAME_MAP[email];
    if (alias && !alias.includes("@")) return alias;
    if (name && !name.includes("@")) return name;
    if (email) return prettifyLocal(email);

    return "Equipo de Ventas";
};
