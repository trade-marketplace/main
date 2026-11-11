import { Suspense } from 'react';
import { MapViewClient } from './map-view';

interface PageProps {
  searchParams: Promise<{ view?: string; filter?: string }>;
}

export default async function JobsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const view = params.view;

  if (view === 'map') {
    return (
      <Suspense fallback={<div />}>
        <MapViewClient />
      </Suspense>
    );
  }

  return (
    <div style={{ padding: '40px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 900 }}>Job Board (Grid View)</h1>
      <p style={{ color: '#52645B', marginTop: '8px' }}>Switch to <a href="/jobs?view=map" style={{ color: '#326C20', fontWeight: 700 }}>Map view</a> to see nearby jobs.</p>
    </div>
  );
}
