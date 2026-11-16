"use client";
import { useState } from "react";
import { SupportStart } from "@/components/messages/SupportStart";
import { SupportList } from "@/components/messages/SupportList";
import { SupportConversationView } from "@/components/messages/SupportConversation";
export const STATES = ["form", "field-errors", "sending", "try-later", "error", "offline", "list", "list-replied", "list-empty", "loading", "list-error", "form-tradie"];
const id = "00000000-0000-4000-8000-000000000186";
export function SupportDemo({ state }: { state: string }) {
 const [sent,setSent]=useState(false),role=state==="form-tradie"?"TRADIE":"CUSTOMER";
 if(sent) return <SupportConversationView viewerId={id} preview send={async()=>({ok:true,threadId:id})} thread={{id,subject:"Account question",closed:false,latestMessageId:id,olderCursor:null,earlier:false,messages:[{id,author:"You",office:false,own:true,body:"Can you help me with my account?",at:"2026-11-12T00:00:00Z",when:"12 Nov, 1:00 pm",photos:[],seen:false}]}} />;
 if(state.startsWith("list")||state==="loading")return <SupportList role={role} preview loading={state==="loading"} data={state==="list-error"?null:{page:1,pages:1,threads:state==="list-empty"?[]:[{id,subject:"Account question",when:"12 Nov, 1:00 pm",unread:state==="list-replied"}]}} replied={{[id]:state==="list-replied"}} />;
 return <SupportStart role={role} preview={state} requestKey={id} initial={["sending","try-later","error"].includes(state)?{subject:"Account question",text:"Can you help me with my account?"}:undefined} action={async()=>({ok:true,threadId:id})} onStarted={()=>setSent(true)} />;
}
