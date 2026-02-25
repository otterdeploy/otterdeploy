import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dash/projects/$projectId/architecture/')(
  {
    component: RouteComponent,
  },
)

function RouteComponent() {
  return <div>Hello "/dash/projects/$projectId/architecture/"!</div>
}
