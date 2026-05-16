import { Nav } from "@/components/Nav";
import { Hero } from "@/components/landing/Hero";
import { RoleStrip } from "@/components/landing/RoleStrip";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { AgentPipeline } from "@/components/landing/AgentPipeline";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <RoleStrip />
        <HowItWorks />
        <AgentPipeline />
      </main>
      <Footer />
    </>
  );
}
