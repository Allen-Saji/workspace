import Landing from "../src/ui/Landing";
import { landingMetadata } from "../src/server/metadata";
export const metadata = landingMetadata();
export default function Home() {
  return <Landing />;
}
