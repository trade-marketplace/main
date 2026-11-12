import { randomUUID } from "node:crypto";
import { beforeEach,describe,expect,it,vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { testDatabaseUrl,useTestSchema } from "../support/test-db";
const fixture=vi.hoisted(()=>({db:null as PrismaClient|null,viewer:{userId:"",role:"TRADIE" as "TRADIE"|"CUSTOMER"}}));
vi.mock("@/server/db",()=>({getDb:()=>{if(!fixture.db)throw Error("No fixture");return fixture.db;}}));
vi.mock("@/server/auth/guard",()=>({withRole:(_roles:readonly string[],read:(viewer:typeof fixture.viewer)=>Promise<unknown>)=>()=>read(fixture.viewer)}));
import { readPhoneAvailability } from "@/app/dev/components/phone-map/read-availability";
describe.skipIf(!testDatabaseUrl)("phone map availability adapter (Postgres)",()=>{
 const schema=useTestSchema(import.meta.filename);
 beforeEach(async()=>{fixture.db=schema.db;fixture.viewer={userId:randomUUID(),role:"TRADIE"};const id=fixture.viewer.userId;
  await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES (${id}::uuid)`;
  await schema.db.profile.create({data:{id,role:"TRADIE",email:id+"@example.test",firstName:"Phone"}});
  await schema.db.workerProfile.create({data:{userId:id,available:false,baseSuburb:"Windsor",areaLat:-46.4,areaLng:168.3,areaRadiusKm:12}});
 });
 it("reads only the current person's two needed flags and performs no write",async()=>{
  const result=await readPhoneAvailability();expect(result).toEqual({ok:true,available:false,paused:false});expect(Object.keys(result).sort()).toEqual(["available","ok","paused"]);
  expect(await schema.db.auditLog.count({where:{actorId:fixture.viewer.userId}})).toBe(0);
 });
 it("rereads saved availability and paused status rather than guessing from browser state",async()=>{
  await schema.db.workerProfile.update({where:{userId:fixture.viewer.userId},data:{available:true,pausedAt:new Date()}});
  expect(await readPhoneAvailability()).toEqual({ok:true,available:true,paused:true});
 });
 it("fails closed if the database role changed after the route was opened",async()=>{
  await schema.db.profile.update({where:{id:fixture.viewer.userId},data:{role:"CUSTOMER"}});
  expect(await readPhoneAvailability()).toEqual({ok:false,error:"unavailable"});
 });
});
