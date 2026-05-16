"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Logo } from "./ui/Logo";
import { Button } from "./ui/Button";

export function Nav() {
  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-50 backdrop-blur-md bg-white/70 border-b border-black/[0.05]"
    >
      <div className="mx-auto max-w-7xl px-6 py-3.5 flex items-center justify-between">
        <Link href="/">
          <Logo />
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-bone/60">
          <Link href="/#how" className="hover:text-bone transition">How it works</Link>
          <Link href="/#agents" className="hover:text-bone transition">Agents</Link>
          <Link href="/employer" className="hover:text-bone transition">Employer</Link>
        </nav>
        <Link href="/employer/new">
          <Button size="sm">Create assessment</Button>
        </Link>
      </div>
    </motion.header>
  );
}
