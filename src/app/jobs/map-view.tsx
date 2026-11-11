'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface JobPin {
  id: string;
  title: string;
  type: 'claim' | 'estimate' | 'bounty';
  displayPrice: string;
  address: string;
  distance: string;
  timeAgo?: string;
  photosCount?: number;
  lat: number;
  lng: number;
}

const MOCK_JOBS: JobPin[] = [
  {
    id: 'job-1',
    title: 'Switchboard upgrade & safety check',
    type: 'claim',
    displayPrice: '$259',
    address: '42 Ponsonby Road, Auckland',
    distance: '1.2 km away',
    lat: 35,
    lng: 40,
  },
  {
    id: 'job-2',
    title: 'Replace leaking vanity trap',
    type: 'estimate',
    displayPrice: 'Estimate',
    photosCount: 3,
    address: '15 Karangahape Road, Auckland',
    distance: '2.4 km away',
    lat: 55,
    lng: 60,
  },
  {
    id: 'job-3',
    title: 'Commercial kitchen extraction quote',
    type: 'bounty',
    displayPrice: '$30 · 17h',
    address: '88 Quay Street, Auckland',
    distance: '3.1 km away',
    lat: 70,
    lng: 30,
  },
];

export function MapViewClient() {
  const searchParams = useSearchParams();
  const filter = searchParams.get('filter') || 'all';
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobPin | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(true);

  const filteredJobs = MOCK_JOBS.filter((job) => {
    if (filter === 'claim' && job.type !== 'claim') return false;
    if (filter === 'estimate' && job.type !== 'estimate') return false;
    if (filter === 'bounty' && job.type !== 'bounty') return false;
    return true;
  });

  if (!hasLocationPermission) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F1ECE5', padding: '40px', textAlign: 'center' }}>
        <div style={{ background: '#fff', padding: '40px', borderRadius: '16px', maxWidth: '480px', boxShadow: '0 10px 30px rgba(12,37,29,0.08)' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#0C251D', marginBottom: '12px' }}>Location permission required</h2>
          <p style={{ color: '#52645B', fontSize: '15px', lineHeight: '1.5', marginBottom: '24px' }}>
            Trade Marketplace needs your location to show jobs near you on the map. Please enable location access in your browser settings.
          </p>
          <button
            onClick={() => setHasLocationPermission(true)}
            style={{ background: '#326C20', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '15px' }}
          >
            Allow location access
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '480px 1fr', height: 'calc(100vh - 64px)', background: '#F1ECE5', position: 'relative', overflow: 'hidden' }}>
      {/* Left Pane: Filter chips & Job list */}
      <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #D8DED9', background: '#fff', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #E9ECE9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 900, color: '#0C251D', margin: 0 }}>Jobs near you</h1>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Link href="/jobs" style={{ padding: '6px 12px', borderRadius: '6px', background: '#E9ECE9', color: '#0C251D', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>Grid</Link>
              <Link href="/jobs?view=map" style={{ padding: '6px 12px', borderRadius: '6px', background: '#326C20', color: '#fff', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>Map</Link>
            </div>
          </div>

          {/* Filter chips with live counts */}
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            <Link
              href="/jobs?view=map"
              style={{
                padding: '6px 12px',
                borderRadius: '20px',
                background: filter === 'all' ? '#0C251D' : '#E9ECE9',
                color: filter === 'all' ? '#fff' : '#0C251D',
                fontSize: '13px',
                fontWeight: 700,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              All ({MOCK_JOBS.length})
            </Link>
            <Link
              href="/jobs?view=map&filter=claim"
              style={{
                padding: '6px 12px',
                borderRadius: '20px',
                background: filter === 'claim' ? '#326C20' : '#E9ECE9',
                color: filter === 'claim' ? '#fff' : '#0C251D',
                fontSize: '13px',
                fontWeight: 700,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Ready to claim ({MOCK_JOBS.filter(j => j.type === 'claim').length})
            </Link>
            <Link
              href="/jobs?view=map&filter=estimate"
              style={{
                padding: '6px 12px',
                borderRadius: '20px',
                background: filter === 'estimate' ? '#0C251D' : '#E9ECE9',
                color: filter === 'estimate' ? '#fff' : '#0C251D',
                fontSize: '13px',
                fontWeight: 700,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Needs estimate ({MOCK_JOBS.filter(j => j.type === 'estimate').length})
            </Link>
            <Link
              href="/jobs?view=map&filter=bounty"
              style={{
                padding: '6px 12px',
                borderRadius: '20px',
                background: filter === 'bounty' ? '#D4AF37' : '#E9ECE9',
                color: filter === 'bounty' ? '#0C251D' : '#0C251D',
                fontSize: '13px',
                fontWeight: 700,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Bounty ({MOCK_JOBS.filter(j => j.type === 'bounty').length})
            </Link>
          </div>
        </div>

        {/* List of jobs */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredJobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#52645B' }}>
              <p style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Nothing in view</p>
              <p style={{ fontSize: '14px' }}>Try panning the map or changing your filters to see more available jobs.</p>
            </div>
          ) : (
            filteredJobs.map((job) => (
              <div
                key={job.id}
                onMouseEnter={() => setHoveredId(job.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => setSelectedJob(job)}
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: hoveredId === job.id ? '2px solid #326C20' : '1px solid #D8DED9',
                  background: '#fff',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: hoveredId === job.id ? '0 4px 12px rgba(50,104,32,0.15)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <span style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 800,
                    background: job.type === 'bounty' ? '#D4AF37' : job.type === 'claim' ? '#EBF4E5' : '#F1ECE5',
                    color: job.type === 'bounty' ? '#0C251D' : job.type === 'claim' ? '#326C20' : '#0C251D',
                  }}>
                    {job.displayPrice}
                  </span>
                  <span style={{ fontSize: '13px', color: '#52645B' }}>{job.distance}</span>
                </div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#0C251D', margin: '0 0 6px' }}>{job.title}</h3>
                <p style={{ fontSize: '13px', color: '#52645B', margin: 0 }}>{job.address}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Pane: Map Canvas */}
      <div style={{ position: 'relative', background: '#E3E8E3', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Simulated Map Background Grid / Texture */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.15, backgroundImage: 'radial-gradient(#0C251D 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

        {/* Map Pins */}
        {filteredJobs.map((job) => {
          const isHovered = hoveredId === job.id;
          return (
            <div
              key={job.id}
              onMouseEnter={() => setHoveredId(job.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => setSelectedJob(job)}
              style={{
                position: 'absolute',
                left: `${job.lng}%`,
                top: `${job.lat}%`,
                transform: `translate(-50%, -50%) scale(${isHovered ? 1.2 : 1})`,
                transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                cursor: 'pointer',
                zIndex: isHovered ? 20 : 10,
              }}
            >
              <div style={{
                padding: '8px 14px',
                borderRadius: '24px',
                background: job.type === 'bounty' ? '#D4AF37' : job.type === 'claim' ? '#0C251D' : '#fff',
                color: job.type === 'bounty' ? '#0C251D' : job.type === 'claim' ? '#fff' : '#0C251D',
                fontWeight: 800,
                fontSize: '13px',
                boxShadow: isHovered ? '0 0 0 4px rgba(50, 104, 32, 0.4), 0 8px 24px rgba(0,0,0,0.2)' : '0 4px 12px rgba(0,0,0,0.15)',
                display: 'flex',
                alignItem: 'center',
                gap: '6px',
                border: job.type === 'estimate' ? '2px solid #0C251D' : 'none',
              }}>
                {job.type === 'estimate' && <span>📷</span>}
                {job.displayPrice}
              </div>
            </div>
          );
        })}

        {/* Selected Job Preview Card Overlay */}
        {selectedJob && (
          <div style={{ position: 'absolute', bottom: '24px', right: '24px', width: '360px', background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 14px 40px rgba(12,37,29,0.2)', zIndex: 30 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontWeight: 800, fontSize: '15px', color: '#0C251D' }}>Job Preview</span>
              <button
                onClick={() => setSelectedJob(null)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#52645B' }}
              >
                ✕
              </button>
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0C251D', marginBottom: '8px' }}>{selectedJob.title}</h3>
            <p style={{ fontSize: '13px', color: '#52645B', marginBottom: '16px' }}>{selectedJob.address}</p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Link
                href={`/jobs/${selectedJob.id}`}
                style={{ flex: 1, textAlign: 'center', background: '#326C20', color: '#fff', padding: '10px 16px', borderRadius: '8px', fontWeight: 700, textDecoration: 'none', fontSize: '14px' }}
              >
                View details
              </Link>
            </div>
          </div>
        )}

        {/* Map Legend */}
        <div style={{ position: 'absolute', top: '24px', right: '24px', background: 'rgba(255,255,255,0.95)', padding: '12px 16px', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', fontWeight: 600, color: '#0C251D', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#0C251D' }}></span> Ready to claim
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#fff', border: '2px solid #0C251D' }}></span> Needs estimate
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#D4AF37' }}></span> Site visit bounty
          </div>
        </div>
      </div>
    </div>
  );
}
