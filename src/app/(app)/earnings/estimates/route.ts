import { permanentRedirect } from "next/navigation";
import { QUOTE_HISTORY_PATH } from "@/lib/my-work";

export function GET() {
  permanentRedirect(QUOTE_HISTORY_PATH);
}
