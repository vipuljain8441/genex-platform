"use client";

import Link from "next/link";
import { Play, ArrowRight } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";

export function PlaybackCTA({ url }: { url: string }) {
  return (
    <Card className="bg-accent/[0.04] border-accent/20">
      <CardBody>
        <div className="flex items-center gap-4">
          <div className="grid place-items-center h-10 w-10 rounded-full bg-accent/15 text-accent">
            <Play className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="font-display text-base font-semibold">
              Session replay available
            </div>
            <div className="text-xs text-bone/55 mt-0.5">
              Watch the full session — code diffs and AI chat synchronised on a timeline.
              Trap moments and commits are bookmarked.
            </div>
          </div>
          <Link
            href={url}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent text-white text-xs font-medium px-3.5 py-2 hover:bg-accent-deep transition"
          >
            Open replay <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
