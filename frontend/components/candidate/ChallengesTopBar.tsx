"use client";

import type { CandidateChallenge, ChallengeResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ChallengesTopBar({
  challenges,
  activeChallengeId,
  responses,
  onSelectChallenge,
}: {
  challenges: CandidateChallenge[];
  activeChallengeId: string | null;
  responses: Record<string, ChallengeResponse>;
  onSelectChallenge: (challengeId: string) => void;
}) {
  if (challenges.length === 0) return null;
  const activeIndex = challenges.findIndex((c) => c.id === activeChallengeId);

  return (
    <div className="flex-shrink-0 flex items-center gap-3 border-b border-[#d8c7a8]/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.94)_0%,_rgba(255,249,238,0.88)_100%)] px-4 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-bone/50">
        Question {Math.max(activeIndex + 1, 1)} / {challenges.length}
      </div>
      <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
        {challenges.map((challenge, index) => {
          const isActive = challenge.id === activeChallengeId;
          const status = responses[challenge.id]?.status ?? "pending";
          return (
            <button
              key={challenge.id}
              onClick={() => onSelectChallenge(challenge.id)}
              title={`Question ${index + 1}`}
              className={cn(
                "grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-[12px] font-semibold transition",
                isActive
                  ? "bg-accent text-white shadow-sm ring-2 ring-accent/30"
                  : status === "completed"
                    ? "bg-[#2f9061]/15 text-[#1f6b46] hover:bg-[#2f9061]/22"
                    : "bg-black/[0.05] text-bone/65 hover:bg-black/[0.08]"
              )}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
