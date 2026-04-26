export const INBOX_REGIONS = {
  cordoba: {
    key: "cordoba",
    label: "Inbox Córdoba",
    phoneIds: ["807747825759387", "729326663073216", "834087939786971"],
    emails: [
      "christian15366@gmail.com",
      "lunacami00@gmail.com",
      "julicisneros.89@gmail.com",
    ],
  },
  villa_maria: {
    key: "villa_maria",
    label: "Inbox Villa María",
    phoneIds: ["1126748053852551", "987669861103912"],
    emails: ["escalantefr.p@gmail.com", "laurialvarez456@gmail.com"],
  },
};

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizePhoneId(phoneId) {
  return String(phoneId || "").trim();
}

export function getConversationPhoneId(conversation) {
  return normalizePhoneId(
    conversation?.scopedPhoneNumberId ||
      conversation?.lastInboundPhoneId ||
      conversation?.lastInboundPhoneID ||
      conversation?.businessPhoneId ||
      conversation?.waPhoneId ||
      ""
  );
}

export function getInboxRegionByEmail(email) {
  const normalized = normalizeEmail(email);
  return (
    Object.values(INBOX_REGIONS).find((region) =>
      region.emails.some((item) => normalizeEmail(item) === normalized)
    ) || null
  );
}

export function isConversationInRegion(conversation, regionOrConfig) {
  const region =
    typeof regionOrConfig === "string"
      ? INBOX_REGIONS[regionOrConfig] || null
      : regionOrConfig || null;

  if (!region) return false;

  const phoneId = getConversationPhoneId(conversation);
  return region.phoneIds.some((item) => normalizePhoneId(item) === phoneId);
}

export function getAssignedUid(conversation) {
  return String(conversation?.assignedToUid || "").trim();
}

export function getAssignedEmail(conversation) {
  return normalizeEmail(conversation?.assignedToEmail || "");
}

export function isConversationUnassigned(conversation) {
  return !getAssignedUid(conversation) && !getAssignedEmail(conversation);
}

export function isConversationAssignedToUser(conversation, userLike) {
  const uid = String(userLike?.uid || "").trim();
  const email = normalizeEmail(userLike?.email || "");

  const assignedUid = getAssignedUid(conversation);
  const assignedEmail = getAssignedEmail(conversation);

  if (uid && assignedUid && assignedUid === uid) return true;
  if (email && assignedEmail && assignedEmail === email) return true;
  return false;
}

export function getConversationAssigneeLabel(conversation) {
  return (
    String(conversation?.assignedToName || "").trim() ||
    getAssignedEmail(conversation) ||
    getAssignedUid(conversation) ||
    "otro agente"
  );
}