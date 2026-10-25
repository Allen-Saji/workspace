import type { Metadata } from "next";
import Workspace from "../../src/ui/Workspace";
export const metadata: Metadata = {
  title: "Your workspace",
  robots: { index: false, follow: false, nocache: true },
};
export default function Dashboard() {
  return <Workspace />;
}
