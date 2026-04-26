import ConversationsList from "./ConversationsList.jsx";
import { INBOX_REGIONS } from "../lib/inboxRegion.js";

const VM_REGION = INBOX_REGIONS.villa_maria;

export default function ConversationsListFernando(props) {
  return (
    <ConversationsList
      {...props}
      allowedPhoneIds={VM_REGION.phoneIds}
      allowedEmails={VM_REGION.emails}
      title={VM_REGION.label}
    />
  );
}
