import { Nav } from "@/components/Nav";
import { JobForm } from "@/components/employer/JobForm";

export default function NewAssessmentPage() {
  return (
    <>
      <Nav />
      <main className="pt-16 pb-24 px-6">
        <JobForm />
      </main>
    </>
  );
}
