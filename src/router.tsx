import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isTenantLockedError, notifyTenantLocked } from "./lib/tenant-lock";

export const getRouter = () => {
  const handleError = (error: unknown) => {
    if (isTenantLockedError(error)) notifyTenantLocked();
  };

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    trailingSlash: "never",
  });

  return router;
};
