import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { canViewJobFiles } from "@/server/files/access";
import { detectFileKind } from "@/server/files/file-type";
import { MAX_UPLOAD_BYTES } from "@/server/files/images";
import { createUploadService, type UploadDb } from "@/server/files/service";
import type { FileStore } from "@/server/files/storage";

// A fake iPhone decoder: real HEVC decoding is the library's job, ours is the wiring around it.
vi.mock("heic-decode", () => ({
  default: async () => ({ width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4).fill(200) }),
}));

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const WORKER = "33333333-3333-4333-8333-333333333333";
const JOB = "44444444-4444-4444-8444-444444444444";
const customer = { userId: CUSTOMER, role: "CUSTOMER" as const };
const tradie = { userId: WORKER, role: "TRADIE" as const };

const GPS_EXIF = { IFD3: { GPSLatitudeRef: "S", GPSLatitude: "41/1 17/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "174/1 46/1 0/1" } };

async function jpeg(width = 3000, height = 2000, colour = "#336699", withGps = true) {
  let image = sharp({ create: { width, height, channels: 3, background: colour } }).jpeg();
  if (withGps) image = image.withExif(GPS_EXIF);
  return image.toBuffer();
}

const png = (width = 50, height = 50) =>
  sharp({ create: { width, height, channels: 3, background: "#aa3300" } }).png().toBuffer();

const heic = () => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(32)]);

function fakes(job: { customerId: string; workerId: string | null; status: string } | null = { customerId: CUSTOMER, workerId: null, status: "REVIEW" }) {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const rows: { id: string; jobId: string; path: string; position: number }[] = [];
  const store: FileStore = {
    put: vi.fn(async (bucket, path, bytes, contentType) => void files.set(`${bucket}/${path}`, { bytes, contentType })),
    signedUrl: vi.fn(async (bucket, path, seconds) => `https://files.test/${bucket}/${path}?expires=${seconds}`),
    remove: vi.fn(async () => undefined),
  };
  const db: UploadDb = {
    job: { findUnique: vi.fn(async () => job) },
    jobPhoto: {
      findFirst: vi.fn(async ({ where }) => rows.find((row) => row.jobId === where.jobId && row.path === where.path) ?? null),
      findMany: vi.fn(async ({ where }) => rows.filter((row) => row.jobId === where.jobId).sort((a, b) => a.position - b.position)),
      count: vi.fn(async ({ where }) => rows.filter((row) => row.jobId === where.jobId).length),
      create: vi.fn(async ({ data }) => {
        const row = { id: `photo-${rows.length}`, jobId: data.jobId, path: data.path, position: data.position };
        rows.push(row);
        return row;
      }),
    },
  };
  return { files, rows, store, db, service: createUploadService({ db, store }) };
}

describe("file type check", () => {
  it("recognises files by their bytes", async () => {
    expect(detectFileKind(await jpeg(10, 10))).toBe("jpeg");
    expect(detectFileKind(await png())).toBe("png");
    expect(detectFileKind(heic())).toBe("heic");
    expect(detectFileKind(Buffer.from("%PDF-1.7\n"))).toBe("pdf");
    expect(detectFileKind(Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(detectFileKind(new Uint8Array())).toBeNull();
  });
});

describe("job photos", () => {
  it("resizes to 1600px WebP, strips GPS and EXIF, and saves privately", async () => {
    const { service, files, rows } = fakes();
    const original = await jpeg();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const photo = await service.addJobPhoto(customer, JOB, original);

    expect(photo.path).toMatch(new RegExp(`^jobs/${JOB}/[0-9a-f]{32}\\.webp$`));
    const saved = files.get(`photos/${photo.path}`)!;
    expect(saved.contentType).toBe("image/webp");
    const meta = await sharp(saved.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(meta.exif).toBeUndefined();
    expect(Buffer.from(saved.bytes).includes(Buffer.from("GPS"))).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it("applies the camera's rotation before dropping it", async () => {
    const { service, files } = fakes();
    const sideways = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#fff" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const photo = await service.addJobPhoto(customer, JOB, sideways);
    const meta = await sharp(files.get(`photos/${photo.path}`)!.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([200, 400]);
  });

  it("never enlarges a small photo", async () => {
    const { service, files } = fakes();
    const photo = await service.addJobPhoto(customer, JOB, await png(300, 200));
    const meta = await sharp(files.get(`photos/${photo.path}`)!.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("converts an iPhone HEIC to a web picture", async () => {
    const { service, files } = fakes();
    const photo = await service.addJobPhoto(customer, JOB, heic());
    const saved = files.get(`photos/${photo.path}`)!;
    expect(saved.contentType).toBe("image/webp");
    expect((await sharp(saved.bytes).metadata()).format).toBe("webp");
  });

  it("rejects a file pretending to be a photo, whatever it is called", async () => {
    const { service, store, rows } = fakes();
    for (const fake of [Buffer.from("<?php echo 1; ?>"), Buffer.from("MZ\u0090\u0000 not a photo"), Buffer.from("%PDF-1.4 a pdf")]) {
      await expect(service.addJobPhoto(customer, JOB, fake)).rejects.toMatchObject({ code: "wrong-type" });
    }
    expect(store.put).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("rejects a file with a photo's first bytes but no picture inside", async () => {
    const { service, store } = fakes();
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("this is not really a jpeg")]);
    await expect(service.addJobPhoto(customer, JOB, broken)).rejects.toMatchObject({ code: "unreadable" });
    expect(store.put).not.toHaveBeenCalled();
  });

  it("rejects empty files and files over 10 MB", async () => {
    const { service } = fakes();
    await expect(service.addJobPhoto(customer, JOB, new Uint8Array())).rejects.toMatchObject({ code: "empty" });
    const big = Buffer.concat([await jpeg(10, 10), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    await expect(service.addJobPhoto(customer, JOB, big)).rejects.toMatchObject({ code: "too-large" });
  });

  it("allows 10 photos and refuses the 11th", async () => {
    const { service, rows } = fakes();
    for (let i = 0; i < 10; i++) await service.addJobPhoto(customer, JOB, await png(20 + i, 20));
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    await expect(service.addJobPhoto(customer, JOB, await png(99, 20))).rejects.toMatchObject({ code: "too-many-photos" });
    expect(rows).toHaveLength(10);
  });

  it("a retry of the same photo gives back the same row, even when the 10 are full", async () => {
    const { service, rows, store } = fakes();
    const first = await service.addJobPhoto(customer, JOB, await png());
    const again = await service.addJobPhoto(customer, JOB, await png());
    expect(again).toEqual(first);
    expect(rows).toHaveLength(1);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it("recovers when an upload dropped after the file was saved but before the row was", async () => {
    const { service, db, rows, files } = fakes();
    const create = vi.spyOn(db.jobPhoto, "create").mockRejectedValueOnce(new Error("connection lost"));
    await expect(service.addJobPhoto(customer, JOB, await png())).rejects.toThrow("connection lost");
    expect(rows).toHaveLength(0);
    create.mockRestore();

    await service.addJobPhoto(customer, JOB, await png());
    expect(rows).toHaveLength(1);
    expect(files.size).toBe(1); // the retry overwrote the same file instead of adding another
  });

  it("returns the existing row when two identical retries race and the database refuses the second", async () => {
    const { service, db, rows } = fakes();
    const first = await service.addJobPhoto(customer, JOB, await png());
    vi.spyOn(db.jobPhoto, "findFirst").mockResolvedValueOnce(null).mockResolvedValue(first);
    vi.spyOn(db.jobPhoto, "create").mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await service.addJobPhoto(customer, JOB, await png())).toEqual(first);
    expect(rows).toHaveLength(1);
  });

  it("only the customer who owns the job, and only before it is priced, can add photos", async () => {
    await expect(fakes().service.addJobPhoto({ userId: OTHER, role: "CUSTOMER" }, JOB, await png())).rejects.toMatchObject({ code: "not-found" });
    await expect(fakes().service.addJobPhoto(tradie, JOB, await png())).rejects.toMatchObject({ code: "not-found" });
    const priced = fakes({ customerId: CUSTOMER, workerId: null, status: "PRICED" });
    await expect(priced.service.addJobPhoto(customer, JOB, await png())).rejects.toMatchObject({ code: "not-allowed" });
    await expect(fakes(null).service.addJobPhoto(customer, JOB, await png())).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("viewing job photos", () => {
  it("gives short-lived signed links, cover first, never a public URL", async () => {
    const { service, store } = fakes();
    await service.addJobPhoto(customer, JOB, await png(20, 20));
    await service.addJobPhoto(customer, JOB, await png(30, 20));
    const links = await service.jobPhotoUrls(customer, JOB);
    expect(links.map((link) => link.position)).toEqual([0, 1]);
    for (const link of links) {
      expect(link.expiresInSeconds).toBeLessThanOrEqual(15 * 60);
      expect(link.url).toContain(`expires=${link.expiresInSeconds}`);
    }
    expect(store.signedUrl).toHaveBeenCalledTimes(2);
  });

  it("is refused to people who may not see the job", async () => {
    const { service, store } = fakes({ customerId: CUSTOMER, workerId: WORKER, status: "ASSIGNED" });
    await expect(service.jobPhotoUrls({ userId: OTHER, role: "CUSTOMER" }, JOB)).rejects.toMatchObject({ code: "not-found" });
    await expect(service.jobPhotoUrls({ userId: OTHER, role: "TRADIE" }, JOB)).rejects.toMatchObject({ code: "not-found" });
    await expect(service.jobPhotoUrls(tradie, JOB)).resolves.toEqual([]);
    expect(store.signedUrl).not.toHaveBeenCalled();
  });

  it("follows the who-can-see rules", () => {
    const job = (status: string, workerId: string | null = null) => ({ customerId: CUSTOMER, workerId, status });
    expect(canViewJobFiles(customer, job("REVIEW"))).toBe(true);
    expect(canViewJobFiles({ userId: OTHER, role: "CUSTOMER" }, job("REVIEW"))).toBe(false);
    expect(canViewJobFiles({ userId: OTHER, role: "ADMIN" }, job("COMPLETED"))).toBe(true);
    expect(canViewJobFiles(tradie, job("REVIEW"))).toBe(true);
    expect(canViewJobFiles(tradie, job("BOOKABLE"))).toBe(true);
    expect(canViewJobFiles(tradie, job("PRICED"))).toBe(false);
    expect(canViewJobFiles(tradie, job("ASSIGNED", OTHER))).toBe(false);
    expect(canViewJobFiles(tradie, job("ASSIGNED", WORKER))).toBe(true);
    expect(canViewJobFiles(tradie, job("CANCELLED"))).toBe(false);
  });
});

describe("documents", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");

  it("keeps a PDF as it is and returns a path in the worker's own folder", async () => {
    const { service, files } = fakes();
    const { path } = await service.addDocument(tradie, "coc", pdf);
    expect(path).toMatch(new RegExp(`^coc/${WORKER}/[0-9a-f]{32}\\.pdf$`));
    expect(files.get(`documents/${path}`)).toMatchObject({ contentType: "application/pdf" });
    expect(Buffer.from(files.get(`documents/${path}`)!.bytes)).toEqual(pdf);
  });

  it("turns a photo of a licence into a WebP with no location", async () => {
    const { service, files } = fakes();
    const { path } = await service.addDocument(tradie, "licences", await jpeg(3000, 2000));
    const saved = files.get(`documents/${path}`)!;
    const meta = await sharp(saved.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
  });

  it("sending the same document twice lands on the same path", async () => {
    const { service, files } = fakes();
    const a = await service.addDocument(tradie, "coc", pdf);
    const b = await service.addDocument(tradie, "coc", pdf);
    expect(a).toEqual(b);
    expect(files.size).toBe(1);
  });

  it("rejects fakes, PDFs that run code, empty and oversized files", async () => {
    const { service } = fakes();
    await expect(service.addDocument(tradie, "coc", Buffer.from("MZ not a pdf"))).rejects.toMatchObject({ code: "wrong-type" });
    await expect(service.addDocument(tradie, "coc", Buffer.from("%PDF-1.4\n<< /JavaScript (app.alert(1)) >>"))).rejects.toMatchObject({ code: "wrong-type" });
    await expect(service.addDocument(tradie, "coc", new Uint8Array())).rejects.toMatchObject({ code: "empty" });
    await expect(service.addDocument(tradie, "coc", Buffer.concat([pdf, Buffer.alloc(MAX_UPLOAD_BYTES)]))).rejects.toMatchObject({ code: "too-large" });
  });

  it("is for workers only", async () => {
    await expect(fakes().service.addDocument(customer, "coc", pdf)).rejects.toMatchObject({ code: "not-allowed" });
  });

  it("links to a document only for its owner and the office", async () => {
    const { service } = fakes();
    const { path } = await service.addDocument(tradie, "licences", pdf);
    const link = await service.documentUrl(tradie, path);
    expect(link.expiresInSeconds).toBeLessThanOrEqual(15 * 60);
    expect(link.url).toContain("documents/");
    await expect(service.documentUrl({ userId: OTHER, role: "ADMIN" }, path)).resolves.toBeDefined();
    await expect(service.documentUrl({ userId: OTHER, role: "TRADIE" }, path)).rejects.toMatchObject({ code: "not-found" });
    await expect(service.documentUrl(customer, path)).rejects.toMatchObject({ code: "not-found" });
    await expect(service.documentUrl(tradie, `licences/${WORKER}/../${OTHER}/x.pdf`)).rejects.toMatchObject({ code: "not-found" });
  });
});
