import { createFileRoute } from "@tanstack/react-router";
import { Visualizer } from "@/components/visualizer/Visualizer";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Visualizer />;
}
