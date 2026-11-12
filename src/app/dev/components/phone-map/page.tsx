import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { WorkerJobBoundary } from "@/components/jobs/WorkerJobBoundary";
import { guardDevPage } from "@/server/dev-pages";
import { PHONE_MAP_STATES } from "@/lib/phone-map";
import { parseBoardQuery } from "@/lib/job-board";
import { previewMapBoard } from "../board-map/preview-data";
import { PhoneMapDemo } from "./PhoneMapDemo";
export const metadata: Metadata = { title: "Phone job map (dev)", robots: { index:false,follow:false } };
export default async function PhoneMapPreview({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  guardDevPage();
  const params=await searchParams, state=params.state==="a-gallery"||params.state==="detail"||params.state==="grid"?params.state:PHONE_MAP_STATES.find(value=>value===params.state)??"peek",board=previewMapBoard("ready"),query=parseBoardQuery(params);
  query.view="map";if(state==="chips-bounty"&&params.kind===undefined)query.kind="bounty";
  const back=typeof params.back==="string"&&params.back.startsWith("/dev/components/phone-map?")&&!params.back.includes("//")?params.back:"/dev/components/phone-map?state=peek";
  return <AppShellView viewer={{role:"TRADIE",firstName:"Jack",lastName:"Wilson",email:"worker@demo.test",emailVerified:true,counts:{messages:0,notifications:0}}} testMode preview={{at:"/jobs?view=map",base:"/dev/components/phone-map?state="+state}}>
    {state==="detail"?<WorkerJobBoundary job={board.cards.find(card=>card.id===params.job)??board.cards[0]} back={back}/>:<PhoneMapDemo key={state} board={board} query={query} state={state} failSave={params.failSave==="1"} banner={params.banner==="1"} legacyPins={params.legacyPins==="mixed"||params.legacyPins==="empty"?params.legacyPins:undefined}/>}
  </AppShellView>;
}
