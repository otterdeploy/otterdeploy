import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@otterstack/ui/components/ui/card";

type ProjectCardProps = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export function ProjectCard({ id, name, slug, createdAt }: ProjectCardProps) {
  return (
    <Link to={`/projects/${id}/architecture`}>
      <Card className="transition-colors hover:border-primary/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{slug}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Created {new Date(createdAt).toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
