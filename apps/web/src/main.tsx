import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { routeTree } from "./route-tree.gen";
import { orpc, queryClient } from "./shared/server/orpc";
import { NotFound } from "./shared/features/errors/not-found";
import { ServerError } from "./shared/features/errors/server-error";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // defaultPendingComponent: () => <Loader />,
  defaultErrorComponent: ServerError,
  defaultNotFoundComponent: NotFound,
  context: { orpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        {/*<CommandPalette />*/}
      </QueryClientProvider>
    );
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element with id 'app' not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RouterProvider router={router} />);
}
