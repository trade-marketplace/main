"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { SwitchField } from "@/components/forms/ChoiceFields";
import { InlineError } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/feedback/Skeleton";
import { useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { MapPin, ClusterPin, useBountyRemaining } from "@/components/map/MapPin";
import { MapSurface, YouAreHere } from "@/components/map/MapSurface";
import { MapboxSurface, type MapboxViewport, type MapboxServices } from "@/components/map/MapboxSurface";
import { QuickFilters } from "@/components/data/QuickFilters";
import { cardToMapJob, cardsInsideBounds, scaleBounds } from "@/lib/board-map";
import { boardHref, boardJobHref, type BoardCard, type BoardCounts, type BoardKind, type BoardMapConfig, type BoardQuery } from "@/lib/job-board";
import { boundsAround, estimatePinWidth, groupOverlappingPins, keepInside, pinText, projectPoint, type Bounds, type MapJob } from "@/lib/map/pins";
import { loadMapbox, lngLat, workAreaBounds, type MapboxConfig, type MapboxMap, type MapboxLibrary } from "@/lib/map/mapbox";
import { phoneCardIndex, phoneCentredBounds, phoneFrameBounds, phoneMapCards, phonePinId } from "@/lib/phone-map";
import type { AvailabilitySave, WorkAreaResult } from "@/lib/account/work-area";
import { setAvailableAction } from "@/server/workers/area-actions";
import { readPhoneAvailability } from "@/app/dev/components/phone-map/read-availability";
import styles from "./phone-map.module.css";

/** A synchronous lock covers repeated events before React can render the pending state. */
export class PhoneAvailabilityRequests {
  pending = false;
  async save(current: boolean, next: boolean, write: AvailabilitySave): Promise<{ available: boolean; result: WorkAreaResult } | null> {
    if (this.pending) return null;
    this.pending = true;
    try { const result = await write(next); return { available: result.ok ? result.snapshot.available : current, result }; }
    catch { return { available: current, result: { ok: false, error: "unavailable" } }; }
    finally { this.pending = false; }
  }
}
type Props = { cards: readonly BoardCard[]; counts?: BoardCounts; query: BoardQuery; config?: BoardMapConfig; serverNow: number;
  onKindChange: (kind: BoardKind) => void; previewState?: string; jobHref?: (id: string) => string; listHref?: string;
  initialAvailability?: { available: boolean; paused: boolean }; saveAvailable?: AvailabilitySave; onRetry?: () => void; embedded?: boolean; onLoadMore?: () => void; loadingMore?: boolean; loading?: boolean };
const KINDS = [{value:"all",label:"All"},{value:"ready",label:"Claim"},{value:"bounty",label:"Bounty"},{value:"estimate",label:"Estimate"}] as const;
export function PhoneMap({ cards, counts, query, config, serverNow, onKindChange, previewState, jobHref, listHref, initialAvailability, saveAvailable = setAvailableAction, onRetry, embedded, onLoadMore, loadingMore, loading }: Props) {
  const id = useId(), fake = Boolean(previewState), online = useOnlineStatus() && previewState !== "offline";
  const token=config?.accessToken??null, areaName=config?.workArea?.name, latitude=config?.workArea?.centre?.lat, longitude=config?.workArea?.centre?.lng, radius=config?.workArea?.radiusKm;
  const provider=useMemo<MapboxConfig|undefined>(()=>areaName?.trim()&&typeof latitude==="number"&&Number.isFinite(latitude)&&typeof longitude==="number"&&Number.isFinite(longitude)&&typeof radius==="number"&&Number.isFinite(radius)&&radius>0
    ?{accessToken:token,workArea:{name:areaName,centre:{lat:latitude,lng:longitude},radiusKm:radius}}:undefined,[token,areaName,latitude,longitude,radius]);
  const liveProvider = useRef<MapboxMap | null>(null);
  const [services] = useState<MapboxServices>(() => ({ load: async () => {
    const library = await loadMapbox();
    return { supported: () => library.supported(), Map: class extends library.Map {
      constructor(options: ConstructorParameters<MapboxLibrary["Map"]>[0]) { super(options); liveProvider.current = this; }
      remove() { if (liveProvider.current === this) liveProvider.current = null; super.remove(); }
    } };
  } }));
  const [availability, setAvailability] = useState(initialAvailability), [readError, setReadError] = useState(false), [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(previewState === "saving-available"), [requests] = useState(() => new PhoneAvailabilityRequests());
  const [expanded, setExpanded] = useState(previewState === "sheet-up"), [failed, setFailed] = useState(false), [viewport, setViewport] = useState<MapboxViewport | null>(null);
  const all = useMemo(() => phoneMapCards(cards), [cards]);
  const jobs = useMemo(() => all.flatMap(card => { const job = cardToMapJob(card); return job ? [job] : []; }), [all]);
  const fit = useMemo(() => {const bounds=boundsAround(jobs.map(job => job.point));return bounds?phoneFrameBounds(bounds):provider?workAreaBounds(provider.workArea):null;}, [jobs, provider]);
  const [camera, setCamera] = useState<Bounds | null>(() => previewState === "no-jobs-in-view" && fit ? { ...fit, north:fit.north+1,south:fit.south+1 } : fit);
  const bounds = viewport?.bounds ?? camera, unavailable = previewState === "map-unavailable" || failed || !fake && !provider?.accessToken;
  const shown = unavailable ? all : cardsInsideBounds(all,bounds);
  const [selectedId, setSelectedId] = useState<string | null>(previewState === "card-selected" ? all[1]?.id ?? all[0]?.id ?? null : all[0]?.id ?? null);
  const pinIds = new Set(jobs.map(job => job.id)), selectable = shown.filter(card => pinIds.has(card.id));
  const nextSelection = selectable.some(card => card.id === selectedId) ? selectedId : selectable[0]?.id ?? null;
  if (nextSelection !== selectedId) setSelectedId(nextSelection);
  const map = useRef<HTMLDivElement>(null), strip = useRef<HTMLDivElement>(null), items = useRef(new Map<string,HTMLAnchorElement>()), pendingScroll = useRef<ReturnType<typeof setTimeout> | null>(null), suppressScroll = useRef(false), scrollRelease = useRef<ReturnType<typeof setTimeout> | null>(null), dragStart = useRef<number | null>(null), sheetDragged = useRef(false), keyboardSelection = useRef(false);
  useEffect(()=>{if(previewState==="card-selected"&&selectedId)items.current.get(selectedId)?.scrollIntoView({block:"nearest",inline:"center",behavior:"instant"});},[previewState,selectedId]);
  const [size,setSize] = useState<{width:number;height:number}|null>(null);
  const visible = Boolean(size?.width);
  useEffect(() => {
    const element=map.current;if(!element)return;
    const measure=()=>{const width=element.clientWidth,height=element.clientHeight;setSize(previous=>previous?.width===width&&previous.height===height?previous:{width,height});const root=element.parentElement;if(root&&!embedded)root.style.setProperty("--phone-top",Math.max(0,root.getBoundingClientRect().top+window.scrollY)+"px");};
    const observer=new ResizeObserver(measure);observer.observe(element);
    const host=element.closest("main");if(host&&!embedded)observer.observe(host);
    const chrome=new MutationObserver(measure);if(!embedded)chrome.observe(document.documentElement,{attributes:true,attributeFilter:["style"]});
    window.addEventListener("resize",measure);return()=>{observer.disconnect();chrome.disconnect();window.removeEventListener("resize",measure);};
  },[embedded]);
  // A sibling notice can move the root without resizing the flex host. Measure after its commit too.
  useEffect(() => {const root=map.current?.parentElement;if(root&&!embedded){const top=Math.max(0,root.getBoundingClientRect().top+window.scrollY)+"px";if(root.style.getPropertyValue("--phone-top")!==top)root.style.setProperty("--phone-top",top);}});
  useEffect(() => () => { if(pendingScroll.current)clearTimeout(pendingScroll.current);if(scrollRelease.current)clearTimeout(scrollRelease.current); },[]);
  const read = async () => { try {const result=await readPhoneAvailability();if(result.ok){setAvailability({available:result.available,paused:result.paused});setReadError(false);}else setReadError(true);}catch{setReadError(true);} };
  useEffect(() => { if(initialAvailability || fake || !visible)return;let active=true;readPhoneAvailability().then(result=>{if(!active)return;if(result.ok)setAvailability({available:result.available,paused:result.paused});else setReadError(true);}).catch(()=>{if(active)setReadError(true);});return()=>{active=false;}; },[initialAvailability,fake,visible]);
  const changeAvailable = async (next:boolean) => {
    if(!availability || availability.paused || requests.pending || saving || !online)return;
    const previous=availability.available;setAvailability({...availability,available:next});setSaving(true);setSaveError(false);
    const answer=await requests.save(previous,next,saveAvailable);
    if(answer){setAvailability(current=>current?{...current,available:answer.available}:current);setSaveError(!answer.result.ok);}setSaving(false);
  };
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const select = (pinId:string, scroll=true) => {
    const job=jobs.find(item=>item.id===pinId);if(!job)return;setSelectedId(pinId);
    if(!fake&&liveProvider.current&&viewport)liveProvider.current.flyTo({center:lngLat(job.point),zoom:liveProvider.current.getZoom(),duration:0});
    else if(bounds)setCamera(phoneCentredBounds(job.point,bounds));
    if(scroll){if(keyboardSelection.current)requestAnimationFrame(()=>items.current.get(pinId)?.focus({preventScroll:true}));suppressScroll.current=true;if(scrollRelease.current)clearTimeout(scrollRelease.current);scrollRelease.current=setTimeout(()=>{suppressScroll.current=false;},700);items.current.get(pinId)?.scrollIntoView({block:"nearest",inline:"center",behavior:reduced()?"instant":"smooth"});}
  };
  const placed=jobs.flatMap(job=>{const at=fake&&camera?projectPoint(job.point,camera):viewport?.project(job.point);return at?[{job,at}]:[];});
  const byId=new Map(placed.map(item=>[item.job.id,item]));
  const pixels=placed.map(({job,at})=>({id:job.id,x:at.x/100*(size?.width??1),y:at.y/100*(size?.height??1),width:estimatePinWidth(pinText(job,null),job.kind!=="claim"),bounty:job.kind==="bounty"}));
  const groups=size?groupOverlappingPins(pixels,selectedId):pixels.map(pixel=>({lead:pixel,members:[pixel]}));
  const pins=<>{fake&&provider&&camera&&<YouAreHere {...(projectPoint(provider.workArea.centre,camera)??{x:50,y:50})}/>}{groups.map(group=>{
    const point=size?{...keepInside(group.lead,size.width,size.height),unit:"px" as const}:byId.get(group.lead.id)!.at;
    return group.members.length===1?<MapPin key={group.lead.id} job={byId.get(group.lead.id)!.job} position={point} serverNow={serverNow} selected={selectedId===group.lead.id} hot={selectedId===group.lead.id} onSelect={pinId=>select(pinId)}/>
      :<ClusterPin key={"cluster-"+group.lead.id} atPin count={group.members.length} bounties={group.members.filter(item=>item.bounty).length} position={point} onZoom={()=>setCamera(boundsAround(group.members.map(item=>byId.get(item.id)!.job.point),.3,.0002))}/>;
  })}</>;
  const title=shown.length+(shown.length===1?" job near you":" jobs near you");
  const rootClass=styles.phone+(embedded?" "+styles.embedded:"");
  return <section className={rootClass} data-phone-map data-expanded={expanded} aria-label={embedded?previewState+" nearby jobs map":"Nearby jobs map"} onPointerDownCapture={()=>{keyboardSelection.current=false;}} onKeyDownCapture={event=>{keyboardSelection.current=event.key==="Enter"||event.key===" ";}}>
    <h1 className={styles.srOnly}>Jobs near you</h1>
    <div className={styles.map} ref={map}>{!unavailable&&(fake?<MapSurface label={embedded?previewState+" map of nearby jobs":"Map of nearby jobs"}>{pins}</MapSurface>:provider&&size&&size.width>0?<MapboxSurface config={provider} services={services} bounds={camera??undefined} label={embedded?previewState+" map of nearby jobs":"Map of nearby jobs"} locationNote="Showing your work area." onViewChange={setViewport} onFailure={()=>setFailed(true)}>{pins}</MapboxSurface>:null)}
      {fake&&!unavailable&&<div className={styles.mapControls}><Button size="sm" width="auto" variant="secondary" onClick={()=>camera&&setCamera(scaleBounds(camera,.5))} aria-label="Zoom in"><Icon name="add" decorative/></Button><Button size="sm" width="auto" variant="secondary" onClick={()=>camera&&setCamera(scaleBounds(camera,2))} aria-label="Zoom out"><Icon name="remove" decorative/></Button></div>}
    </div>
    <div className={styles.floating}><div className={styles.available} data-available={availability?.available} aria-busy={saving||!availability}>
      <SwitchField label={!availability?"Availability":availability.available?"You’re available":"Not available"} checked={availability?.available??false} disabled={!availability||availability.paused} aria-disabled={saving||!online||undefined} onChange={event=>void changeAvailable(event.target.checked)}/>
      {saving&&<span role="status" className={styles.saving}>Saving availability…</span>}
      {availability&&!availability.available&&<p>You won’t get job alerts.</p>}
      {readError&&<InlineError message="Couldn’t load availability." onRetry={()=>void read()}/>}
      {saveError&&<InlineError message="Couldn’t save." onRetry={()=>availability&&void changeAvailable(!availability.available)}/>}
      {!online&&<p role="status">You’re offline.</p>}
    </div><QuickFilters label={embedded?previewState+" map job kind":"Map job kind"} value={query.kind} onChange={onKindChange} items={KINDS.map(kind=>({...kind,count:counts?.[kind.value]??all.filter(card=>kind.value==="all"||kind.value==="bounty"&&card.status==="QUOTE_BOUNTY"||kind.value==="ready"&&card.status==="BOOKABLE"||kind.value==="estimate"&&card.status==="REVIEW").length,...(kind.value==="bounty"?{tone:"gold" as const}:{})}))}/></div>
    <div className={styles.sheet} data-unavailable={unavailable}>
      <button type="button" className={styles.handle} data-sheet-handle aria-label={expanded?"Show map":"Show list"} aria-expanded={expanded} aria-controls={id+"-cards"} onPointerDown={event=>{dragStart.current=event.clientY;sheetDragged.current=false;event.currentTarget.setPointerCapture(event.pointerId);}} onPointerUp={event=>{if(dragStart.current!==null){const delta=event.clientY-dragStart.current;dragStart.current=null;if(Math.abs(delta)>40){sheetDragged.current=true;setExpanded(delta<0);}}}} onClick={()=>{if(sheetDragged.current){sheetDragged.current=false;return;}setExpanded(value=>!value);}}><span/></button>
      <header className={styles.sheetHeader}><h2>{title}</h2><Link href={listHref??boardHref({...query,view:"grid"})}>List</Link></header>
      {(loading||previewState==="loading")?<div role="status" aria-label="Loading your jobs" className={styles.empty}><Skeleton width="70%" height={20}/><Skeleton height={104}/></div>:previewState==="error"?<div className={styles.empty}><h3>Can’t load your jobs</h3><Button variant="secondary" onClick={onRetry}>Try again</Button></div>:<>
        {unavailable&&<p role="status" className={styles.mapError}>Map isn’t available right now.</p>}
        {!shown.length?<div className={styles.empty}><h3>No jobs here. Zoom out.</h3><Button variant="secondary" onClick={()=>setCamera(fit?{...fit}:null)}>Zoom out</Button></div>:<div id={id+"-cards"} ref={strip} className={styles.cards} role="region" aria-label={embedded?previewState+" jobs near you":"Jobs near you"} aria-roledescription="carousel"
          onKeyDown={event=>{if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();const index=phoneCardIndex(selectable,selectedId),next=phonePinId(selectable,Math.max(0,Math.min(selectable.length-1,index+(event.key==="ArrowRight"?1:-1))));if(next){select(next);items.current.get(next)?.focus({preventScroll:true});}}}
          onScroll={()=>{if(expanded||suppressScroll.current||!selectable.length)return;if(pendingScroll.current)clearTimeout(pendingScroll.current);pendingScroll.current=setTimeout(()=>{const element=strip.current;if(!element)return;const nearest=selectable.reduce((best,card)=>Math.abs((items.current.get(card.id)?.offsetLeft??0)-element.scrollLeft)<Math.abs((items.current.get(best.id)?.offsetLeft??0)-element.scrollLeft)?card:best,selectable[0]);if(nearest&&nearest.id!==selectedId)select(nearest.id,false);},140);}}>
          {shown.map(card=><PhoneJobCard key={card.id} card={card} job={cardToMapJob(card)} selected={selectedId===card.id} serverNow={serverNow} href={jobHref?.(card.id)??boardJobHref(card.id,boardHref(query))} anchorRef={element=>{if(element)items.current.set(card.id,element);else items.current.delete(card.id);}}/>) }{onLoadMore&&<div className={styles.moreCard}><Button variant="secondary" loading={loadingMore} disabled={!online?"You’re offline":false} onClick={onLoadMore}>Load more jobs</Button></div>}</div>}
      </>}
    </div>
  </section>;
}
function PhoneJobCard({card,job,selected,serverNow,href,anchorRef}:{card:BoardCard;job:MapJob|null;selected:boolean;serverNow:number;href:string;anchorRef:(element:HTMLAnchorElement|null)=>void}) {
  const remaining=useBountyRemaining(job??{id:card.id,kind:"estimate",title:card.title,suburb:card.suburb,point:card.point!,precision:"approximate"},serverNow);
  const bounty=card.status==="QUOTE_BOUNTY",hours=remaining===null?null:Math.max(0,Math.ceil(remaining/3_600_000));
  const money=(cents:number)=>new Intl.NumberFormat("en-NZ",{style:"currency",currency:"NZD",minimumFractionDigits:2}).format(cents/100);
  const earn=bounty&&card.bounty?"Quote it · earn "+money(card.bounty.amountCents):card.status==="BOOKABLE"&&card.earnCents!==null?"Earn "+money(card.earnCents):card.status==="BOOKABLE"?"Pay pending":bounty?"Quote in person":"Quote from photos";
  return <Link ref={anchorRef} className={styles.card} data-bounty={bounty} data-selected={selected} data-card-id={card.id} aria-current={selected?"true":undefined} href={href}>
    {card.photoUrl?<Image src={card.photoUrl} alt="" width={56} height={64} unoptimized className={styles.photo}/>:<span className={styles.photo}><Icon name={bounty?"water_heater":"construction"} decorative/></span>}
    <span className={styles.cardText}><span className={styles.tag}>{bounty?job?.kind==="bounty"?`Bounty · ${hours===0?"Expired":hours+"h"}`:"Quote bounty":card.status==="BOOKABLE"?"Ready to claim":"Needs a quote"}</span><strong>{card.title}</strong><span className={styles.meta}>{new Intl.NumberFormat("en-NZ",{maximumFractionDigits:1}).format(card.distanceKm)} km · {card.suburb}</span><b>{earn}</b></span>
  </Link>;
}
