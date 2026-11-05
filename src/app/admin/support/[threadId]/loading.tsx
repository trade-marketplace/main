import { OfficeSupportConversation } from "@/components/office/OfficeSupport";
import { parseOfficeSupportQuery } from "@/lib/office-support";
export default function Loading() { return <OfficeSupportConversation query={parseOfficeSupportQuery({})} data={null} loading />; }
