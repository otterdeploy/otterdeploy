"use client";

import {
  useFonts,
  font,
  DotGridBackground,
  Nav,
  Hero,
  AnimatedTerminalSection,
  BentoGrid,
  FeatureTabs,
  ContributorShowcase,
  TestimonialsSection,
  TwoColumns,
  PricingGrid,
  CTA,
  Footer,
} from "@/components/landing";

export default function HomePage() {
  useFonts();

  return (
    <div
      className="bg-[#09090b] text-[#fafafa] min-h-screen relative overflow-x-hidden"
      style={font.body}
    >
      <DotGridBackground />
      <Nav />
      <Hero />
      <AnimatedTerminalSection />
      <BentoGrid />
      <FeatureTabs />
      <ContributorShowcase />
      <TestimonialsSection />
      <TwoColumns />
      <PricingGrid />
      <CTA />
      <Footer />
    </div>
  );
}
