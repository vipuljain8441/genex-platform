"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function CandidateSubmittedPage() {
  const params = useParams<{ id: string }>();

  return (
    <>
      <Nav />
      <main className="pt-16 pb-24 px-6">
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardBody className="py-14 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-accent/12 text-accent">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight">
                Assessment submitted
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-bone/60">
                Your work, activity history, and Buddy interactions have been saved for employer review.
                This page does not show the employer report.
              </p>
              <div className="mt-4 text-xs text-bone/40 font-mono">
                Session {params.id}
              </div>
              <div className="mt-8">
                <Link href="/">
                  <Button>Back to home</Button>
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  );
}
