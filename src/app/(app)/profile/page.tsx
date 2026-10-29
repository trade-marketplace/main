import { redirect } from "next/navigation";

// Keep the existing Account menu/bottom-bar journey usable until the profile editor (#112) replaces this entry.
export default function AccountEntry() { redirect("/profile/security"); }
