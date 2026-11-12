import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpCentre } from "@/components/help/HelpCentre";
import { SupportStart } from "@/components/messages/SupportStart";
import { SupportList } from "@/components/messages/SupportList";
import SupportLoading from "@/app/(app)/support/loading";
import HelpHome from "@/app/(site)/help/page";
import HelpArticlePage from "@/app/(site)/help/[slug]/page";
import { getViewer } from "@/server/auth/viewer";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),unstable_rethrow:(error:unknown)=>{if(error instanceof Error&&error.message==="NEXT_REDIRECT")throw error;},notFound:()=>{throw Error("NEXT_NOT_FOUND");}}));
vi.mock("@/server/auth/viewer",()=>({getViewer:vi.fn()}));
vi.mock("@/app/(site)/help/actions",()=>({saveHelpFeedback:vi.fn()}));
vi.mock("@/server/messages/support-actions",()=>({openSupportThreadAction:vi.fn()}));
const key="00000000-0000-4000-8000-000000000186";
describe("starting private support",()=>{
 it("uses the private opener on the signed-in help card and keeps the guest email",()=>{
  for(const signedIn of [true,false]){const html=renderToStaticMarkup(<HelpCentre signedIn={signedIn} articles={[]} submit={async()=>({status:"saved"})}/>);const card=html.slice(html.indexOf("<aside"));expect(card).toMatch(new RegExp(`href="${signedIn?"/support/new":"mailto:hello@trademarketplace.nz"}"[^>]*>[\\s\\S]*?Message us`));}
 });
 it("keeps the originating help search in the support Back context",()=>{const html=renderToStaticMarkup(<HelpCentre signedIn articles={[]} query="pay" submit={async()=>({status:"saved"})}/>);expect(html).toContain("/support/new?returnTo=%2Fhelp%3Fq%3Dpay");});
 it("hands the office help card directly to its existing support inbox",()=>{const html=renderToStaticMarkup(<HelpCentre signedIn officeSupport articles={[]} submit={async()=>({status:"saved"})}/>);expect(html).toContain('href="/admin/support"');expect(html).not.toContain('href="/support/new"');});
 it("inherits the current customer or tradie palette in the shared loading fallback",()=>{for(const mode of ["customer","trade"]){const html=renderToStaticMarkup(<div data-mode={mode}><SupportLoading/></div>);expect(html.match(/data-mode=/g)).toHaveLength(1);expect(html).toContain(`data-mode="${mode}"`);expect(html).toContain("Loading messages");}});
 it.each([["","",true],["Account","",true],["","Help me",true],[" ","Help me",true],["Account","Help me",false]])("validates subject %j and message %j before enabling Send",(subject,text,disabled)=>{
  const html=renderToStaticMarkup(<SupportStart role="CUSTOMER" requestKey={key} initial={{subject,text}}/>);const send=html.match(/<button[^>]*type="submit"[^>]*>/)?.[0];expect(send).toBeDefined();expect(send?.includes('aria-disabled="true"')).toBe(disabled);
 });
 it("keeps each thread link private with the list Back context, Replied and an accessible unread dot",()=>{
  const html=renderToStaticMarkup(<SupportList role="TRADIE" data={{page:2,pages:3,threads:[{id:key,subject:"Account",when:"12 Nov",unread:true}]}} replied={{[key]:true}}/>);expect(html).toContain("Replied");expect(html).toContain("Unread:");expect(html).toContain(`/support/${key}?returnTo=%2Fsupport%3Fpage%3D2`);
 });
});

describe("public Help support-link viewer fallback",()=>{
 const pages=[()=>HelpHome({searchParams:Promise.resolve({})}),()=>HelpArticlePage({params:Promise.resolve({slug:"leaving-a-review"}),searchParams:Promise.resolve({})})];
 it("keeps both public Help routes usable with guest email when the viewer lookup fails",async()=>{
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  try{for(const page of pages){vi.mocked(getViewer).mockRejectedValueOnce(Error("Session service unavailable"));const element=await page();expect(element.props.signedIn).toBe(false);expect(element.props.officeSupport).toBe(false);const html=renderToStaticMarkup(element);expect(html.slice(html.indexOf("<aside"))).toContain('href="mailto:hello@trademarketplace.nz"');}expect(log).toHaveBeenCalledTimes(2);}finally{log.mockRestore();}
 });
 it("preserves navigation errors rather than converting them to signed-out Help",async()=>{for(const page of pages){const navigation=Error("NEXT_REDIRECT");vi.mocked(getViewer).mockRejectedValueOnce(navigation);await expect(page()).rejects.toBe(navigation);}});
});
