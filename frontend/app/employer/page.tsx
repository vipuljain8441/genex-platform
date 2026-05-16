"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Plus, ChevronRight } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { api, type Assessment } from "@/lib/api";
import { relativeTime, shortId } from "@/lib/utils";

export default function EmployerDashboard() {
  const [items, setItems] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listAssessments().then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Nav />
      <main className="pt-12 pb-24 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-end justify-between mb-8">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-accent">
                Employer dashboard
              </div>
              <h1 className="mt-2 font-display text-4xl tracking-tight font-semibold">
                Your assessments
              </h1>
            </div>
            <Link href="/employer/new">
              <Button><Plus className="h-4 w-4" /> New</Button>
            </Link>
          </div>

          {loading ? (
            <div className="text-bone/40 text-center py-16">Loading…</div>
          ) : items.length === 0 ? (
            <Card>
              <CardBody className="text-center py-16">
                <div className="font-display text-2xl">No assessments yet</div>
                <p className="mt-2 text-bone/55">Spin up your first assessment.</p>
                <div className="mt-6">
                  <Link href="/employer/new"><Button>Create one</Button></Link>
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-3">
              {items.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Link href={`/employer/${a.id}`}>
                    <Card className="hover:border-black/[0.12] transition-colors">
                      <CardBody className="flex items-center gap-5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <Badge tone="accent">#{shortId(a.id)}</Badge>
                            <Badge tone={a.status.stage === "ready" ? "accent" : a.status.stage === "failed" ? "coral" : "violet"}>
                              {a.status.stage}
                            </Badge>
                            <span className="text-[11px] text-bone/40 capitalize">
                              {a.job.role_family} · {a.job.seniority}
                            </span>
                          </div>
                          <div className="font-display text-xl font-semibold truncate">
                            {a.job.title}
                          </div>
                          <div className="mt-1 text-xs text-bone/40">
                            {relativeTime(a.created_at)}
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-bone/30" />
                      </CardBody>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
