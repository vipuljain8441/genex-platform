import { Logo } from "../ui/Logo";

export function Footer() {
  return (
    <footer className="border-t border-black/[0.04] py-10">
      <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <Logo />
        <div className="text-xs text-bone/40">
          © {new Date().getFullYear()} SkillBrew · GenEx is a hackathon project
        </div>
        <div className="flex gap-5 text-xs text-bone/40">
          <a href="https://skillbrew.ai" target="_blank" rel="noreferrer" className="hover:text-bone transition">
            skillbrew.ai
          </a>
        </div>
      </div>
    </footer>
  );
}
