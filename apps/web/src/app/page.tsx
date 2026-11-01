import { RideApp } from '@/components/RideApp';

// No authentication in this assessment: the app acts as the seeded demo rider.
const RIDER_ID = process.env.NEXT_PUBLIC_DEMO_RIDER_ID ?? '00000000-0000-4000-8000-000000000001';

export default function Home() {
  return (
    <main className="page">
      <header className="header">
        <span className="logo" aria-hidden="true">●</span>
        <h1>Lahore Rides</h1>
      </header>
      <RideApp riderId={RIDER_ID} />
    </main>
  );
}
