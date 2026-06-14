import { createFileRoute } from "@tanstack/react-router";
import {
  CtaBand,
  DeployBand,
  FeatureTabs,
  Footer,
  Hero,
  Nav,
  ValueColumns,
} from "@/components/landing/landing";

export const Route = createFileRoute("/1")({
  component: HomeLight,
});

// Variant B — light page (existing light token values), with dark bands as
// punctuation: a dark hero, a dark deploy terminal, and a dark CTA.
function HomeLight() {
  return (
    <main className="light bg-background text-foreground">
      <Nav />
      <Hero dark />
      <FeatureTabs />
      <DeployBand dark />
      <ValueColumns />
      <CtaBand />
      <Footer />
    </main>
  );
}
