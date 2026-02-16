import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnMoveEnd,
  type OnNodeDrag,
  type OnNodesDelete,
  type OnSelectionChangeFunc,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@otterstack/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@otterstack/ui/components/ui/card";

import { orpc } from "@/utils/orpc";

import { ArchitectureCanvas } from "./architecture-canvas";
import { CreateResourceDialog } from "./create-resource-dialog";
import { DetailsPanel } from "./details-panel";
import type {
  ArchitectureGraphPayload,
  ResourceEdge,
  ResourceKind,
  ResourceLinkType,
  ResourceNode,
  ResourceStatus,
} from "./types";

function cloneNodes(nodes: ResourceNode[]) {
  return nodes.map((node) => ({
    ...node,
    position: {
      ...node.position,
    },
    data: {
      ...node.data,
      metadata: {
        ...node.data.metadata,
      },
    },
  }));
}

function cloneEdges(edges: ResourceEdge[]) {
  return edges.map((edge) => ({
    ...edge,
    data: edge.data
      ? {
          ...edge.data,
        }
      : {
          linkType: "network" as ResourceLinkType,
        },
  }));
}

type GraphSnapshot = {
  nodes: ResourceNode[];
  edges: ResourceEdge[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
};

function createSnapshot(
  nodes: ResourceNode[],
  edges: ResourceEdge[],
  viewport: { x: number; y: number; zoom: number },
): GraphSnapshot {
  return {
    nodes: cloneNodes(nodes),
    edges: cloneEdges(edges),
    viewport: {
      x: viewport.x,
      y: viewport.y,
      zoom: viewport.zoom,
    },
  };
}

type ArchitecturePageProps = {
  projectId: string;
};

export function ArchitecturePage({ projectId }: ArchitecturePageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [nodes, setNodes] = useState<ResourceNode[]>([]);
  const [edges, setEdges] = useState<ResourceEdge[]>([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [past, setPast] = useState<GraphSnapshot[]>([]);
  const [future, setFuture] = useState<GraphSnapshot[]>([]);

  const flowRef = useRef<ReactFlowInstance<ResourceNode, ResourceEdge> | null>(null);
  const moveDebounceRef = useRef<number | null>(null);
  const isBootstrappingDevRef = useRef(false);
  const dragStartSnapshotRef = useRef<GraphSnapshot | null>(null);

  const listProjectsQuery = useQuery(
    orpc.architecture.listProjects.queryOptions({
      enabled: projectId === "dev",
    }),
  );

  const graphQuery = useQuery(
    orpc.architecture.get.queryOptions({
      input: {
        projectId,
      },
      enabled: projectId !== "dev",
    }),
  );

  const createProjectMutation = useMutation(orpc.project.create.mutationOptions());
  const seedStarterMutation = useMutation(orpc.architecture.seedStarter.mutationOptions());
  const createResourceMutation = useMutation(orpc.architecture.createResource.mutationOptions());
  const updateResourceMutation = useMutation(orpc.architecture.updateResource.mutationOptions());
  const deleteResourceMutation = useMutation(orpc.architecture.deleteResource.mutationOptions());
  const createLinkMutation = useMutation(orpc.architecture.createLink.mutationOptions());
  const deleteLinkMutation = useMutation(orpc.architecture.deleteLink.mutationOptions());
  const updateViewportMutation = useMutation(orpc.architecture.updateViewport.mutationOptions());
  const replaceGraphMutation = useMutation(orpc.architecture.replaceGraph.mutationOptions());

  useEffect(() => {
    if (projectId !== "dev") {
      return;
    }

    if (listProjectsQuery.isLoading || isBootstrappingDevRef.current) {
      return;
    }

    if (listProjectsQuery.data && listProjectsQuery.data.length > 0) {
      void navigate({
        to: "/project/$id",
        params: {
          id: listProjectsQuery.data[0].id,
        },
        replace: true,
      });
      return;
    }

    if (listProjectsQuery.isSuccess && listProjectsQuery.data.length === 0) {
      isBootstrappingDevRef.current = true;

      void (async () => {
        try {
          const created = await createProjectMutation.mutateAsync({
            name: "Otterstack Production",
          });

          await seedStarterMutation.mutateAsync({
            projectId: created.project.id,
            environmentId: created.environment.id,
          });

          await navigate({
            to: "/project/$id",
            params: {
              id: created.project.id,
            },
            replace: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to create dev project";
          toast.error(message);
        } finally {
          isBootstrappingDevRef.current = false;
        }
      })();
    }
  }, [
    createProjectMutation,
    listProjectsQuery.data,
    listProjectsQuery.isLoading,
    listProjectsQuery.isSuccess,
    navigate,
    projectId,
    seedStarterMutation,
  ]);

  useEffect(() => {
    if (!graphQuery.data) {
      return;
    }

    const nextNodes = graphQuery.data.nodes as ResourceNode[];
    const nextEdges = graphQuery.data.edges as ResourceEdge[];

    setNodes(cloneNodes(nextNodes));
    setEdges(cloneEdges(nextEdges));
    setViewport({
      x: graphQuery.data.viewport.x,
      y: graphQuery.data.viewport.y,
      zoom: graphQuery.data.viewport.zoom,
    });
    setSelectedNodeId(null);
    setPast([]);
    setFuture([]);

    if (flowRef.current) {
      flowRef.current.setViewport(graphQuery.data.viewport, {
        duration: 300,
      });
    }
  }, [graphQuery.data]);

  const graphIdentity = useMemo(() => {
    if (!graphQuery.data) {
      return null;
    }

    return {
      projectId: graphQuery.data.project.id,
      environmentId: graphQuery.data.environment.id,
      projectName: graphQuery.data.project.name,
      environmentName: graphQuery.data.environment.name,
    };
  }, [graphQuery.data]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }

    return nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const snapshot = useCallback(() => {
    return createSnapshot(nodes, edges, viewport);
  }, [edges, nodes, viewport]);

  const applySnapshot = useCallback((value: GraphSnapshot) => {
    setNodes(cloneNodes(value.nodes));
    setEdges(cloneEdges(value.edges));
    setViewport({ ...value.viewport });
    if (flowRef.current) {
      flowRef.current.setViewport(value.viewport, {
        duration: 250,
      });
    }
  }, []);

  const pushHistory = useCallback((current: GraphSnapshot) => {
    setPast((previous) => {
      const next = [...previous, current];
      return next.slice(-80);
    });
    setFuture([]);
  }, []);

  const persistGraph = useCallback(
    async (state: GraphSnapshot) => {
      if (!graphIdentity) {
        return;
      }

      await replaceGraphMutation.mutateAsync({
        projectId: graphIdentity.projectId,
        environmentId: graphIdentity.environmentId,
        graph: {
          nodes: state.nodes.map((node) => ({
            id: node.id,
            position: {
              x: node.position.x,
              y: node.position.y,
            },
            data: {
              name: node.data.name,
              kind: node.data.kind,
              status: node.data.status,
              metadata: node.data.metadata,
            },
          })),
          edges: state.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            data: {
              linkType: edge.data?.linkType ?? "network",
            },
          })),
          viewport: {
            x: state.viewport.x,
            y: state.viewport.y,
            zoom: state.viewport.zoom,
          },
        },
      });
    },
    [graphIdentity, replaceGraphMutation],
  );

  const onUndo = useCallback(async () => {
    const previous = past[past.length - 1];

    if (!previous) {
      return;
    }

    const current = snapshot();

    setPast((value) => value.slice(0, -1));
    setFuture((value) => [...value, current]);
    applySnapshot(previous);

    try {
      await persistGraph(previous);
    } catch (error) {
      applySnapshot(current);
      setPast((value) => [...value, previous]);
      setFuture((value) => value.slice(0, -1));
      const message = error instanceof Error ? error.message : "Failed to undo";
      toast.error(message);
    }
  }, [applySnapshot, past, persistGraph, snapshot]);

  const onRedo = useCallback(async () => {
    const next = future[future.length - 1];

    if (!next) {
      return;
    }

    const current = snapshot();

    setFuture((value) => value.slice(0, -1));
    setPast((value) => [...value, current]);
    applySnapshot(next);

    try {
      await persistGraph(next);
    } catch (error) {
      applySnapshot(current);
      setFuture((value) => [...value, next]);
      setPast((value) => value.slice(0, -1));
      const message = error instanceof Error ? error.message : "Failed to redo";
      toast.error(message);
    }
  }, [applySnapshot, future, persistGraph, snapshot]);

  const onCreateResource = useCallback(
    async (input: { name: string; kind: ResourceKind; status: ResourceStatus }) => {
      if (!graphIdentity || !flowRef.current) {
        return;
      }

      const previous = snapshot();
      pushHistory(previous);

      const viewportCenter = flowRef.current.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });

      const optimisticId = `tmp-${crypto.randomUUID()}`;
      const optimisticNode: ResourceNode = {
        id: optimisticId,
        type: "resource",
        position: {
          x: viewportCenter.x,
          y: viewportCenter.y,
        },
        data: {
          name: input.name,
          kind: input.kind,
          status: input.status,
          metadata: {},
        },
      };

      setNodes((value) => [...value, optimisticNode]);
      setSelectedNodeId(optimisticId);

      try {
        const created = await createResourceMutation.mutateAsync({
          projectId: graphIdentity.projectId,
          environmentId: graphIdentity.environmentId,
          name: input.name,
          kind: input.kind,
          status: input.status,
          metadata: {},
          position: optimisticNode.position,
        });

        setNodes((value) =>
          value.map((node) => {
            if (node.id !== optimisticId) {
              return node;
            }

            return {
              ...(created as ResourceNode),
            };
          }),
        );
        setSelectedNodeId(created.id);
      } catch (error) {
        applySnapshot(previous);
        const message = error instanceof Error ? error.message : "Failed to create resource";
        toast.error(message);
      }
    },
    [
      applySnapshot,
      createResourceMutation,
      graphIdentity,
      pushHistory,
      snapshot,
      setSelectedNodeId,
      setNodes,
    ],
  );

  const onUpdateNode = useCallback(
    async (input: {
      nodeId: string;
      name: string;
      kind: ResourceKind;
      status: ResourceStatus;
    }) => {
      if (!graphIdentity) {
        return;
      }

      const previous = snapshot();
      pushHistory(previous);

      setNodes((value) =>
        value.map((node) => {
          if (node.id !== input.nodeId) {
            return node;
          }

          return {
            ...node,
            data: {
              ...node.data,
              name: input.name,
              kind: input.kind,
              status: input.status,
            },
          };
        }),
      );

      try {
        await updateResourceMutation.mutateAsync({
          projectId: graphIdentity.projectId,
          resourceId: input.nodeId,
          name: input.name,
          kind: input.kind,
          status: input.status,
        });
      } catch (error) {
        applySnapshot(previous);
        const message = error instanceof Error ? error.message : "Failed to update resource";
        toast.error(message);
      }
    },
    [applySnapshot, graphIdentity, pushHistory, snapshot, updateResourceMutation],
  );

  const onDeleteNode = useCallback(
    async (nodeId: string) => {
      if (!graphIdentity) {
        return;
      }

      const previous = snapshot();
      pushHistory(previous);

      setNodes((value) => value.filter((node) => node.id !== nodeId));
      setEdges((value) => value.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      setSelectedNodeId(null);

      try {
        await deleteResourceMutation.mutateAsync({
          projectId: graphIdentity.projectId,
          resourceId: nodeId,
        });
      } catch (error) {
        applySnapshot(previous);
        const message = error instanceof Error ? error.message : "Failed to delete resource";
        toast.error(message);
      }
    },
    [applySnapshot, deleteResourceMutation, graphIdentity, pushHistory, snapshot],
  );

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!graphIdentity || !connection.source || !connection.target) {
        return;
      }

      const previous = snapshot();
      pushHistory(previous);

      const optimisticId = `edge-${crypto.randomUUID()}`;
      const optimisticEdge: ResourceEdge = {
        id: optimisticId,
        source: connection.source,
        target: connection.target,
        type: "smoothstep",
        data: {
          linkType: "network",
        },
      };

      setEdges((value) => addEdge(optimisticEdge, value) as ResourceEdge[]);

      try {
        const created = await createLinkMutation.mutateAsync({
          projectId: graphIdentity.projectId,
          sourceResourceId: optimisticEdge.source,
          targetResourceId: optimisticEdge.target,
          linkType: "network",
        });

        setEdges((value) =>
          value.map((edge) => {
            if (edge.id !== optimisticId) {
              return edge;
            }

            return {
              ...(created as ResourceEdge),
            };
          }),
        );
      } catch (error) {
        applySnapshot(previous);
        const message = error instanceof Error ? error.message : "Failed to connect resources";
        toast.error(message);
      }
    },
    [applySnapshot, createLinkMutation, graphIdentity, pushHistory, snapshot],
  );

  const onNodesDelete = useCallback<OnNodesDelete<ResourceNode>>(
    async (deletedNodes) => {
      if (!graphIdentity) {
        return;
      }

      const current = snapshot();
      const previous = {
        ...current,
        nodes: [...current.nodes, ...cloneNodes(deletedNodes)],
      };

      pushHistory(previous);

      try {
        await Promise.all(
          deletedNodes.map(async (node) => {
            await deleteResourceMutation.mutateAsync({
              projectId: graphIdentity.projectId,
              resourceId: node.id,
            });
          }),
        );
      } catch (error) {
        applySnapshot(previous);
        const message = error instanceof Error ? error.message : "Failed to delete resources";
        toast.error(message);
      }
    },
    [applySnapshot, deleteResourceMutation, graphIdentity, pushHistory, snapshot],
  );

  const onEdgesDelete = useCallback(
    async (deletedEdges: ResourceEdge[]) => {
      if (!graphIdentity || deletedEdges.length === 0) {
        return;
      }

      const current = snapshot();
      const previous = {
        ...current,
        edges: [...current.edges, ...cloneEdges(deletedEdges)],
      };

      pushHistory(previous);

      try {
        await Promise.all(
          deletedEdges.map(async (edge) => {
            await deleteLinkMutation.mutateAsync({
              projectId: graphIdentity.projectId,
              linkId: edge.id,
            });
          }),
        );
      } catch (error) {
        applySnapshot(previous);
        const message = error instanceof Error ? error.message : "Failed to delete links";
        toast.error(message);
      }
    },
    [applySnapshot, deleteLinkMutation, graphIdentity, pushHistory, snapshot],
  );

  const onNodesChange = useCallback((changes: NodeChange<ResourceNode>[]) => {
    setNodes((currentNodes) => {
      return applyNodeChanges(changes, currentNodes) as ResourceNode[];
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<ResourceEdge>[]) => {
    setEdges((currentEdges) => {
      return applyEdgeChanges(changes, currentEdges) as ResourceEdge[];
    });
  }, []);

  const onSelectionChange = useCallback<OnSelectionChangeFunc>(({ nodes: selectedNodes }) => {
    setSelectedNodeId(selectedNodes[0]?.id ?? null);
  }, []);

  const onMoveEnd = useCallback<OnMoveEnd>(
    (_event, viewportValue) => {
      if (!graphIdentity) {
        return;
      }

      setViewport({
        x: viewportValue.x,
        y: viewportValue.y,
        zoom: viewportValue.zoom,
      });

      if (moveDebounceRef.current !== null) {
        window.clearTimeout(moveDebounceRef.current);
      }

      moveDebounceRef.current = window.setTimeout(() => {
        void updateViewportMutation.mutateAsync({
          projectId: graphIdentity.projectId,
          environmentId: graphIdentity.environmentId,
          viewport: {
            x: viewportValue.x,
            y: viewportValue.y,
            zoom: viewportValue.zoom,
          },
        });
      }, 250);
    },
    [graphIdentity, updateViewportMutation],
  );

  const onNodeDragStart = useCallback<OnNodeDrag<ResourceNode>>(() => {
    dragStartSnapshotRef.current = snapshot();
  }, [snapshot]);

  const onNodeDragStop = useCallback<OnNodeDrag<ResourceNode>>(
    async (_event, node, _nodes) => {
      if (!graphIdentity) {
        return;
      }

      const dragStartSnapshot = dragStartSnapshotRef.current;
      if (dragStartSnapshot) {
        pushHistory(dragStartSnapshot);
        dragStartSnapshotRef.current = null;
      }

      try {
        await updateResourceMutation.mutateAsync({
          projectId: graphIdentity.projectId,
          resourceId: node.id,
          position: {
            x: node.position.x,
            y: node.position.y,
          },
        });
      } catch (error) {
        if (dragStartSnapshot) {
          applySnapshot(dragStartSnapshot);
        }
        const message = error instanceof Error ? error.message : "Failed to persist node position";
        toast.error(message);
      }
    },
    [applySnapshot, graphIdentity, pushHistory, updateResourceMutation],
  );

  useEffect(() => {
    return () => {
      if (moveDebounceRef.current !== null) {
        window.clearTimeout(moveDebounceRef.current);
      }
    };
  }, []);

  if (projectId === "dev" && (listProjectsQuery.isLoading || isBootstrappingDevRef.current)) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0f1e] text-slate-200">
        Bootstrapping development project...
      </div>
    );
  }

  if (graphQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0f1e] text-slate-200">
        Loading architecture canvas...
      </div>
    );
  }

  if (graphQuery.isError || !graphQuery.data) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0f1e] px-4">
        <Card className="max-w-xl border-white/10 bg-[#0f1527] text-slate-100">
          <CardHeader>
            <CardTitle>Project not found</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-300">
            <p>
              This project either does not exist yet, or you do not have access. Create a new project and we will
              seed it with a starter architecture.
            </p>
            <Button
              onClick={async () => {
                try {
                  const created = await createProjectMutation.mutateAsync({
                    name: "Otterstack Production",
                  });

                  await seedStarterMutation.mutateAsync({
                    projectId: created.project.id,
                    environmentId: created.environment.id,
                  });

                  await queryClient.invalidateQueries({
                    queryKey: orpc.architecture.listProjects.key(),
                  });

                  await navigate({
                    to: "/project/$id",
                    params: {
                      id: created.project.id,
                    },
                    replace: true,
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Failed to create project";
                  toast.error(message);
                }
              }}
            >
              Create project
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const payload = graphQuery.data as ArchitectureGraphPayload;

  return (
    <div className="h-full bg-[radial-gradient(circle_at_top,#111936,#070b17_58%)] p-4">
      <ArchitectureCanvas
        projectName={payload.project.name}
        environmentName={payload.environment.name}
        nodes={nodes}
        edges={edges}
        onCreateClick={() => setIsCreateOpen(true)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(connection: Connection) => {
          void onConnect(connection);
        }}
        onNodesDelete={(deletedNodes) => {
          void onNodesDelete(deletedNodes);
        }}
        onEdgesDelete={(deletedEdges) => {
          void onEdgesDelete(deletedEdges);
        }}
        onSelectionChange={onSelectionChange}
        onMoveEnd={onMoveEnd}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={(event, node, selectedNodes) => {
          void onNodeDragStop(event, node, selectedNodes);
        }}
        onInit={(instance) => {
          flowRef.current = instance;
          instance.setViewport(payload.viewport, {
            duration: 0,
          });
        }}
        onZoomIn={() => flowRef.current?.zoomIn()}
        onZoomOut={() => flowRef.current?.zoomOut()}
        onFitView={() => flowRef.current?.fitView({ duration: 250, padding: 0.2 })}
        onUndo={() => {
          void onUndo();
        }}
        onRedo={() => {
          void onRedo();
        }}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
      />

      <DetailsPanel selectedNode={selectedNode} onUpdateNode={onUpdateNode} onDeleteNode={onDeleteNode} />

      <CreateResourceDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSubmit={onCreateResource}
      />
    </div>
  );
}
