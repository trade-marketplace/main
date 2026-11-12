import { renderToStaticMarkup } from "react-dom/server";
import { previewMapBoard } from "@/app/dev/components/board-map/preview-data";
import { DEFAULT_BOARD_QUERY } from "@/lib/job-board";
import { describe, expect, it, vi } from "vitest";
import { phoneCardIndex, phoneCentredBounds, phoneFrameBounds, phoneMapCards, phonePinId } from "@/lib/phone-map";
import { PhoneMap, PhoneAvailabilityRequests } from "@/components/jobs/PhoneMap";
import type { WorkAreaResult } from "@/lib/account/work-area";
vi.mock("@/app/dev/components/phone-map/read-availability",()=>({readPhoneAvailability:vi.fn()}));
vi.mock("@/server/workers/area-actions",()=>({setAvailableAction:vi.fn()}));
const snapshot={available:false,paused:false,baseSuburb:"Windsor",point:{lat:-46.4,lng:168.3},radiusKm:12,trades:["OTHER" as const]};
describe("phone map",()=>{
 it("puts bounties first and retains the board ordering within each group",()=>{
  const cards=[{id:"ready",status:"BOOKABLE"},{id:"gold2",status:"QUOTE_BOUNTY"},{id:"quote",status:"REVIEW"},{id:"gold1",status:"QUOTE_BOUNTY"}] as const;
  const sorted=phoneMapCards(cards);expect(sorted.map(card=>card.id)).toEqual(["gold2","gold1","ready","quote"]);expect(cards[0].id).toBe("ready");
 });
 it("maps every pin id to the same sorted card and handles missing/invalid indexes",()=>{
  const cards=[{id:"gold"},{id:"ready"}];for(let i=0;i<cards.length;i++)expect(phoneCardIndex(cards,phonePinId(cards,i))).toBe(i);
  expect(phoneCardIndex(cards,"missing")).toBe(-1);expect(phoneCardIndex(cards,null)).toBe(-1);expect(phonePinId(cards,-1)).toBeNull();expect(phonePinId(cards,.5)).toBeNull();
 });
 it("centres the approximate point while keeping the existing zoom span",()=>{
  expect(phoneCentredBounds({lat:-46,lng:168},{north:-45,south:-47,east:170,west:166})).toEqual({north:-45,south:-47,east:170,west:166});
  expect(phoneCentredBounds({lat:-44,lng:172},{north:-45,south:-47,east:170,west:166})).toEqual({north:-43,south:-45,east:174,west:170});
 });
 it("reserves floating-control and sheet room without changing longitude",()=>{expect(phoneFrameBounds({north:10,south:0,east:170,west:166})).toEqual({north:12.5,south:-6,east:170,west:166});});
 it("uses configured bounty earnings and expiry without customer prices or invented defaults",()=>{
  const now=Date.parse("2026-11-11T05:00:00Z"),board=previewMapBoard("ready",now),card={...board.cards.find(card=>card.status==="QUOTE_BOUNTY")!,bounty:{amountCents:4500,endsAt:now+36*3_600_000,durationMs:36*3_600_000}};
  const html=renderToStaticMarkup(<PhoneMap cards={[card]} query={{...DEFAULT_BOARD_QUERY,view:"map"}} serverNow={now} previewState="peek" initialAvailability={{available:true,paused:false}} onKindChange={()=>{}}/>);
  expect(html).toContain("Quote it · earn $45.00");expect(html).toContain("Bounty · 36h");expect(html).not.toContain("$30");expect(html).not.toContain("priceCents");
 });
 it("excludes exact-coordinate cards from map interaction instead of centring their point",()=>{
  const now=Date.parse("2026-11-11T05:00:00Z"),card={...previewMapBoard("ready",now).cards[0],title:"Exact private card",precision:"exact" as const};
  const html=renderToStaticMarkup(<PhoneMap cards={[card]} query={{...DEFAULT_BOARD_QUERY,view:"map"}} serverNow={now} previewState="peek" initialAvailability={{available:true,paused:false}} onKindChange={()=>{}}/>);
  expect(html).not.toContain("Exact private card");expect(html).toContain("No jobs here. Zoom out.");
 });
 it("keeps legacy cards readable while selecting only a card with a corresponding pin",()=>{
  const now=Date.parse("2026-11-11T05:00:00Z"),board=previewMapBoard("ready",now),valid=board.cards.find(card=>card.status==="BOOKABLE")!;
  const missingPay={...valid,id:"missing-pay",title:"Missing pay",earnCents:null},missingTiming={...board.cards.find(card=>card.status==="QUOTE_BOUNTY")!,id:"missing-timing",title:"Missing timing",point:valid.point,bounty:undefined};
  const render=(cards:typeof board.cards)=>renderToStaticMarkup(<PhoneMap cards={cards} query={{...DEFAULT_BOARD_QUERY,view:"map"}} config={board.meta.map} serverNow={now} previewState="peek" initialAvailability={{available:true,paused:false}} onKindChange={()=>{}}/>);
  const mixed=render([missingTiming,missingPay,valid]);expect([...mixed.matchAll(/data-selected="true" data-card-id="([^"]+)"/g)].map(match=>match[1])).toEqual([valid.id]);expect(mixed).toContain("Pay pending");expect(mixed).toContain("Quote in person");
  const legacyOnly=render([missingTiming,missingPay]);expect(legacyOnly).not.toContain('data-selected="true"');expect(legacyOnly).toContain("Missing pay");expect(legacyOnly).toContain("Missing timing");
 });
 it("calls the availability action only once while a save is in flight",async()=>{
  const requests=new PhoneAvailabilityRequests();let finish!:(result:WorkAreaResult)=>void;const write=vi.fn(()=>new Promise<WorkAreaResult>(resolve=>{finish=resolve;}));
  const first=requests.save(true,false,write);expect(await requests.save(true,false,write)).toBeNull();expect(write).toHaveBeenCalledExactlyOnceWith(false);
  finish({ok:true,snapshot});expect((await first)?.available).toBe(false);expect(requests.pending).toBe(false);
 });
 it("rolls back to the actual previous preference on failure and permits retry",async()=>{
  const requests=new PhoneAvailabilityRequests();expect((await requests.save(true,false,async()=>({ok:false,error:"unavailable"})))?.available).toBe(true);
  expect((await requests.save(false,true,async()=>{throw Error("offline");}))?.available).toBe(false);
  expect((await requests.save(true,false,async()=>({ok:true,snapshot})))?.available).toBe(false);
 });
});
