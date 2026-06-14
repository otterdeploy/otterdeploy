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

export const Route = createFileRoute("/")({
  component: Home,
});

// Variant A — dark drench. Every section carries the `dark` flag, so the whole
// page uses the existing dark token values from styles/app.css.
function Home() {
  return (
    <main className="dark bg-background text-foreground">
      <Nav dark />
      <Hero dark />
      <DeployBand dark />
      <FeatureTabs dark />
      <ValueColumns dark />
      <CtaBand />
      <Footer dark />
    </main>
  );
}
