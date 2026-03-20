/** @jsxImportSource react */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

interface WelcomeEmailProps {
  username?: string;
  loginUrl?: string;
}

export function WelcomeEmail({
  username = "there",
  loginUrl = "http://localhost:5173",
}: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to otterstack!</Preview>
      <Tailwind>
        <Body className="bg-gray-100 font-sans">
          <Container className="mx-auto mb-16 max-w-[600px] rounded-md bg-white px-0 pb-12 pt-5">
            <Heading className="my-10 text-center text-2xl font-bold text-gray-800">
              Welcome to otterstack!
            </Heading>
            <Text className="px-12 text-base leading-7 text-gray-800">
              Hi {username},
            </Text>
            <Text className="px-12 text-base leading-7 text-gray-800">
              Thanks for signing up! We're excited to have you on board.
            </Text>
            <Section className="py-7 text-center">
              <Button
                className="inline-block rounded-md bg-black px-8 py-3 text-base font-bold text-white no-underline"
                href={loginUrl}
              >
                Get Started
              </Button>
            </Section>
            <Text className="mt-5 px-12 text-xs leading-6 text-gray-400">
              If you didn't create an account, you can safely ignore this email.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default WelcomeEmail;
