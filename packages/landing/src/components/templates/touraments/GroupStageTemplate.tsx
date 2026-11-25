import type { FC } from 'react';
import Image from 'next/image';

import type { WorldCupYearData } from '@/data/touraments/international/world-cup/types';
import type { GroupData, TeamStanding } from '@/data/touraments/types/group';
import { KNOCKOUT_DATA as WC_KNOCKOUT_DATA } from '@/data/touraments/international/world-cup/knock-out';
import { KNOCKOUT_DATA as EURO_KNOCKOUT_DATA } from '@/data/touraments/international/euro';
import { KNOCKOUT_DATA as COPA_KNOCKOUT_DATA } from '@/data/touraments/international/copa';
import { KNOCKOUT_DATA as AFCON_KNOCKOUT_DATA } from '@/data/touraments/international/afcon';
import { KNOCKOUT_DATA as AFC_KNOCKOUT_DATA } from '@/data/touraments/international/afc';
import { KNOCKOUT_DATA as ASEA_KNOCKOUT_DATA } from '@/data/touraments/international/asean';
import { KNOCKOUT_DATA as CONCACAF_KNOCKOUT_DATA } from '@/data/touraments/international/concacaf';
import { KNOCKOUT_DATA as PL_KNOCKOUT_DATA } from '@/data/touraments/club/premier-league';
import { KNOCKOUT_DATA as LL_KNOCKOUT_DATA } from '@/data/touraments/club/la-liga';
import { KNOCKOUT_DATA as BL_KNOCKOUT_DATA } from '@/data/touraments/club/bundesliga';
import { KNOCKOUT_DATA as CL_KNOCKOUT_DATA } from '@/data/touraments/club/champions-league';
import type { TournamentSlug } from '@/data/touraments/tournament';
import { KnockoutLink } from '@/components/molecules/KnockoutLink';

export const GroupTable: FC<{
  group: GroupData;
  teams: Record<string, { id: string; name: string; iso: string }>;
}> = ({ group, teams }) => {
  const hasStandings = group.standings != null;

  return (
    <div className="border-base-300 bg-base-100 overflow-hidden rounded-xl border">
      <div className="border-base-300 bg-base-200 text-primary border-b px-4 py-2.5 text-sm tracking-widest uppercase">
        {group.label}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-base-300 text-base-content/60 border-b">
            <th className="w-8 px-1 py-2 text-center">#</th>
            <th className="px-2 py-2 text-left">Team</th>
            {hasStandings && (
              <>
                <th className="w-8 px-1 py-2 text-center">Pld</th>
                <th className="w-8 px-1 py-2 text-center">W</th>
                <th className="w-8 px-1 py-2 text-center">D</th>
                <th className="w-8 px-1 py-2 text-center">L</th>
                <th className="w-8 px-1 py-2 text-center">GF</th>
                <th className="w-8 px-1 py-2 text-center">GA</th>
                <th className="w-8 px-1 py-2 text-center">GD</th>
              </>
            )}
            <th
              className={`px-1 py-2 text-center font-semibold ${hasStandings ? 'text-base-content' : 'text-base-content/60'}`}>
              {hasStandings ? 'Pts' : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          {group.teams.map((teamId, i) => {
            const info = teams[teamId];
            const s: TeamStanding | undefined = hasStandings
              ? group.standings![teamId]
              : undefined;
            const advance = i < 2;
            return (
              <tr
                key={teamId}
                className={`border-base-300/60 border-b transition-colors ${
                  advance ? 'bg-primary/5' : ''
                }`}>
                <td
                  className={`px-1 py-2 text-center font-mono ${advance ? 'text-primary' : 'text-base-content/50'}`}>
                  {i + 1}
                </td>
                <td className="flex items-center gap-2 px-2 py-2">
                  {info && (
                    <>
                      <Image
                        src={`https://flagcdn.com/w20/${info.iso}.png`}
                        alt=""
                        width={20}
                        height={15}
                        className="inline-block h-3 w-4 rounded-sm object-cover"
                      />
                      <span
                        className={
                          advance
                            ? 'text-base-content font-medium'
                            : 'text-base-content'
                        }>
                        {info.name}
                      </span>
                    </>
                  )}
                  {!info && (
                    <span className="text-base-content/50">{teamId}</span>
                  )}
                </td>
                {hasStandings && s && (
                  <>
                    <td className="text-base-content/70 px-1 py-2 text-center">
                      {s.pld}
                    </td>
                    <td className="text-base-content/70 px-1 py-2 text-center">
                      {s.w}
                    </td>
                    <td className="text-base-content/70 px-1 py-2 text-center">
                      {s.d}
                    </td>
                    <td className="text-base-content/70 px-1 py-2 text-center">
                      {s.l}
                    </td>
                    <td className="text-base-content/70 px-1 py-2 text-center">
                      {s.gf}
                    </td>
                    <td className="text-base-content/70 px-1 py-2 text-center">
                      {s.ga}
                    </td>
                    <td
                      className={`px-1 py-2 text-center font-mono ${
                        s.gd > 0
                          ? 'text-success'
                          : s.gd < 0
                            ? 'text-error'
                            : 'text-base-content/60'
                      }`}>
                      {s.gd > 0 ? `+${s.gd}` : s.gd}
                    </td>
                    <td className="text-base-content px-1 py-2 text-center font-semibold">
                      {s.pts}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const KNOCKOUT_DATA_MAP: Record<TournamentSlug, Record<number, unknown>> = {
  'world-cup': WC_KNOCKOUT_DATA,
  euro: EURO_KNOCKOUT_DATA,
  'copa-america': COPA_KNOCKOUT_DATA,
  afcon: AFCON_KNOCKOUT_DATA,
  afc: AFC_KNOCKOUT_DATA,
  concacaf: CONCACAF_KNOCKOUT_DATA,
  asean: ASEA_KNOCKOUT_DATA,
  'premier-league': PL_KNOCKOUT_DATA,
  'la-liga': LL_KNOCKOUT_DATA,
  bundesliga: BL_KNOCKOUT_DATA,
  'champions-league': CL_KNOCKOUT_DATA,
};

export const GroupStageTemplate: FC<{
  wc: WorldCupYearData;
  tournament?: TournamentSlug;
}> = ({ wc, tournament = 'world-cup' }) => {
  const knockoutData = KNOCKOUT_DATA_MAP[tournament];
  return (
    <>
      {wc.groups.length > 0 ? (
        <>
          {knockoutData[wc.year] && (
            <KnockoutLink year={wc.year} tournament={tournament} />
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {wc.groups.map((group) => (
              <GroupTable key={group.name} group={group} teams={wc.teams} />
            ))}
          </div>
        </>
      ) : (
        <>
          {knockoutData[wc.year] && (
            <KnockoutLink year={wc.year} tournament={tournament} />
          )}
          <div className="text-base-content/60 mt-12 text-center text-sm">
            {wc.year} was a straight knockout tournament with no group stage.
          </div>
        </>
      )}
    </>
  );
};
GroupStageTemplate.displayName = 'GroupStageTemplate';
