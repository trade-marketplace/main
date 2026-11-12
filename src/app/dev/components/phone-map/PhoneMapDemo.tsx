"use client";
import { useState } from "react";
import Link from "next/link";
import { BoardMap } from "@/components/jobs/BoardMap";
import { PhoneMap } from "@/components/jobs/PhoneMap";
import { PHONE_MAP_STATES } from "@/lib/phone-map";
import { matchesBoardKind, type BoardPage, type BoardQuery } from "@/lib/job-board";
import styles from "./preview.module.css";
export function PhoneMapDemo({board,query:initialQuery,state:initialState,failSave,legacyPins}:{board:BoardPage;query:BoardQuery;state:string;failSave:boolean;legacyPins?:"mixed"|"empty"}) {
 const [query,setQuery]=useState(initialQuery),[state,setState]=useState(initialState),[calls,setCalls]=useState(0);
 const changeKind=(kind:BoardQuery["kind"])=>{setQuery(previous=>({...previous,kind}));const url=new URL(location.href);url.searchParams.set("kind",kind);history.replaceState(null,"",url.pathname+url.search);};
 const back=()=>"/dev/components/phone-map?state="+state+"&kind="+query.kind;
 const bounty=board.cards.filter(card=>card.status==="QUOTE_BOUNTY"),ready=board.cards.filter(card=>card.status==="BOOKABLE");
 const legacy=[{...bounty[0],point:bounty[1].point,bounty:undefined},{...ready[0],point:ready[1].point,earnCents:null}];
 const sample=legacyPins?legacyPins==="empty"?legacy:[...legacy,bounty[1],ready[1]]:board.cards;
 const cards=sample.filter(card=>matchesBoardKind(card,query.kind));
 const show=(example:string,embedded=false)=><PhoneMap key={example} cards={embedded&&example==="chips-bounty"?board.cards.filter(card=>card.status==="QUOTE_BOUNTY"):cards} counts={board.counts} query={embedded&&example==="chips-bounty"?{...query,kind:"bounty"}:query} config={board.meta.map} serverNow={Date.parse(board.before)} previewState={example} embedded={embedded}
  initialAvailability={{available:example!=="available-off",paused:example==="paused"}} onKindChange={changeKind}
  jobHref={id=>"/dev/components/phone-map?state=detail&job="+encodeURIComponent(id)+"&back="+encodeURIComponent(back())} listHref={"/dev/components/phone-map?state=grid&kind="+query.kind}
  onRetry={()=>setState("peek")} saveAvailable={async available=>{setCalls(value=>value+1);await new Promise(resolve=>setTimeout(resolve,120));return failSave?{ok:false,error:"unavailable"}:{ok:true,snapshot:{available,paused:false,baseSuburb:"Invercargill",point:board.meta.map!.workArea.centre,radiusKm:12,trades:["OTHER"]}};}}/>;
 if(state==="grid")return <section className={styles.grid}><h1>Jobs near you</h1><Link href={"/dev/components/phone-map?state=peek&kind="+query.kind}>Map</Link>{cards.map(card=><Link key={card.id} href={"/dev/components/phone-map?state=detail&job="+card.id+"&back="+encodeURIComponent("/dev/components/phone-map?state=grid&kind="+query.kind)}>{card.title}</Link>)}</section>;
 return <><div className={styles.desktop}><h1>Jobs near you</h1><BoardMap cards={cards} counts={board.counts} query={query} config={board.meta.map} ownerId={board.meta.ownerId} serverNow={Date.parse(board.before)} onKindChange={changeKind} previewState="ready"/></div>
 <div className={styles.phone}>{state==="a-gallery"?<div className={styles.gallery}><h1>Phone map states</h1>{PHONE_MAP_STATES.map(example=><section key={example}><h2>{example}</h2>{show(example,true)}</section>)}</div>:show(state)}</div>
 <output className={styles.srOnly} aria-label="Availability calls">{calls}</output></>;
}
