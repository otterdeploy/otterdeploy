// import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { Button } from "@otterstack/ui/components/ui/button";
// import { Skeleton } from "@otterstack/ui/components/ui/skeleton";

// import { getOrganizationId, orpc } from "@/utils/orpc";
// import { ProjectCard } from "@/components/dashboard/project-card";
// import { CreateProjectDialog } from "@/components/dashboard/create-project-dialog";
// import { EmptyState } from "@/components/dashboard/empty-state";

export const Route = createFileRoute("/_dashboard/dashboard")({
  component: FormExample,
});

// function DashboardPage() {
//   const organizationId = getOrganizationId() ?? "";

//   const projectsQuery = useQuery(
//     orpc.project.list.queryOptions({
//       input: { organizationId, page: 1, pageSize: 50 },
//       enabled: !!organizationId,
//     }),
//   );

//   return (
//     <div className="flex-1 space-y-6 p-6">
//       <div className="flex items-center justify-between">
//         <div>
//           <h1 className="text-2xl font-bold">Projects</h1>
//           <p className="text-muted-foreground text-sm">Manage your infrastructure projects</p>

//           <Button>
//             <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="mr-2 size-4" />
//             New Project
//           </Button>
//         </div>
//         {projectsQuery.data && projectsQuery.data.items.length > 0 && (
//           <CreateProjectDialog>
//             <Button
//               render={
//                 <>
//                   <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="mr-2 size-4" />
//                   New Project
//                 </>
//               }
//             />
//           </CreateProjectDialog>
//         )}
//       </div>

//       {projectsQuery.isLoading && (
//         <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
//           {Array.from({ length: 3 }).map((_, i) => (
//             <Skeleton key={i} className="h-32 rounded-lg" />
//           ))}
//         </div>
//       )}

//       {projectsQuery.data && projectsQuery.data.items.length === 0 && <EmptyState />}

//       {projectsQuery.data && projectsQuery.data.items.length > 0 && (
//         <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
//           {projectsQuery.data.items.map((project) => (
//             <ProjectCard
//               key={project.id}
//               id={project.id}
//               name={project.name}
//               slug={project.slug}
//               createdAt={project.createdAt}
//               updatedAt={project.updatedAt}
//             />
//           ))}
//         </div>
//       )}
//     </div>
//   );
// }

import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@otterstack/ui/components/ui/alert-dialog";
import { Badge } from "@otterstack/ui/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@otterstack/ui/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@otterstack/ui/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@otterstack/ui/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@otterstack/ui/components/ui/field";
import { Input } from "@otterstack/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@otterstack/ui/components/ui/select";
import { Textarea } from "@otterstack/ui/components/ui/textarea";

import {
  BluetoothIcon,
  MoreVerticalCircle01Icon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  CodeIcon,
  MoreHorizontalCircle01Icon,
  SearchIcon,
  FloppyDiskIcon,
  DownloadIcon,
  EyeIcon,
  LayoutIcon,
  PaintBoardIcon,
  SunIcon,
  MoonIcon,
  ComputerIcon,
  UserIcon,
  CreditCardIcon,
  SettingsIcon,
  KeyboardIcon,
  LanguageCircleIcon,
  NotificationIcon,
  MailIcon,
  ShieldIcon,
  HelpCircleIcon,
  File01Icon,
  LogoutIcon,
} from "@hugeicons/core-free-icons";

function CardExample() {
  return (
    <Card className="relative w-full max-w-sm overflow-hidden pt-0">
      <div className="bg-primary absolute inset-0 z-30 aspect-video opacity-50 mix-blend-color" />
      <img
        src="https://images.unsplash.com/photo-1604076850742-4c7221f3101b?q=80&w=1887&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
        alt="Photo by mymind on Unsplash"
        title="Photo by mymind on Unsplash"
        className="relative z-20 aspect-video w-full object-cover brightness-60 grayscale"
      />
      <CardHeader>
        <CardTitle>Observability Plus is replacing Monitoring</CardTitle>
        <CardDescription>
          Switch to the improved way to explore your data, with natural language. Monitoring will no
          longer be available on the Pro plan in November, 2025
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <AlertDialog>
          <AlertDialogTrigger render={<Button />}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} data-icon="inline-start" />
            Show Dialog
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogMedia>
                <HugeiconsIcon icon={BluetoothIcon} strokeWidth={2} />
              </AlertDialogMedia>
              <AlertDialogTitle>Allow accessory to connect?</AlertDialogTitle>
              <AlertDialogDescription>
                Do you want to allow the USB accessory to connect to this device?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Don&apos;t allow</AlertDialogCancel>
              <AlertDialogAction>Allow</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Badge variant="secondary" className="ml-auto">
          Warning
        </Badge>
      </CardFooter>
    </Card>
  );
}

const frameworks = ["Next.js", "SvelteKit", "Nuxt.js", "Remix", "Astro"] as const;

const roleItems = [
  { label: "Developer", value: "developer" },
  { label: "Designer", value: "designer" },
  { label: "Manager", value: "manager" },
  { label: "Other", value: "other" },
];

function FormExample() {
  const [notifications, setNotifications] = React.useState({
    email: true,
    sms: false,
    push: true,
  });
  const [theme, setTheme] = React.useState("light");

  return (
    <div>
      <Button>Click me</Button>
    </div>
  );
}
