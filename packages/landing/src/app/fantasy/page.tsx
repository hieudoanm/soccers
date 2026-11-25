import type { Metadata } from 'next';
import { SquadManager } from '@/components/organisms/SquadManager';

export const metadata: Metadata = {
  title: 'Fantasy',
  description: 'Build squads, pick formations and track matches.',
};

const FantasyPage = () => (
  <div className="mx-auto flex h-[calc(100dvh-9rem)] min-h-[36rem] w-full max-w-7xl flex-col gap-3 p-4">
    <h1 className="text-base-content text-lg font-bold">Fantasy</h1>
    <div className="min-h-0 flex-1">
      <SquadManager />
    </div>
  </div>
);

export default FantasyPage;
