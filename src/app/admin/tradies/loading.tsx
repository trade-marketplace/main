import { OfficeTradies } from "@/components/office/OfficeTradies";
import { tradiesQuery } from "@/lib/office-tradies";
export default function Loading() { return <OfficeTradies data={{ viewerId: "", rows: [], selected: null, total: 0, page: 1, counts: { check: 0, verified: 0, paused: 0 }, today: "" }} query={tradiesQuery({})} state="loading" />; }
