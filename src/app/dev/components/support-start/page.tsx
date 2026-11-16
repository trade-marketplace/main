import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { guardDevPage } from "@/server/dev-pages";
import { SupportDemo } from "./SupportDemo";
export const metadata: Metadata = {title:"Support (dev)",robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{state?:string}>}){
  guardDevPage();
 const {state="form"}=await searchParams;
 return <AppShellView viewer={{role:state==="form-tradie"?"TRADIE":"CUSTOMER",firstName:"Sarah",lastName:"Thompson",email:"preview@example.test",emailVerified:true,counts:{messages:0,notifications:0}}} testMode preview={{at:"/support/new",base:"/dev/components/support-start"}}><SupportDemo key={state} state={state}/></AppShellView>;
}
